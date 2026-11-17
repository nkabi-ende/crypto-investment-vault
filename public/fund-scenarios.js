// The public scenario calculator is local to the browser and never writes account balances.
export function calculateFundScenario(principal, rate, days) {
  if (![100, 200].includes(principal) || !Number.isFinite(rate) || rate < -100 || rate > 100 || !Number.isInteger(days) || days < 1 || days > 90) {
    throw new RangeError('Choose a $100 or $200 fund, a daily change from −100% to 100%, and 1–90 days.');
  }
  const values = [{day: 0, balance: principal, profit: 0, daily: 0}];
  for (let day = 1; day <= days; day++) {
    const balance = principal * Math.pow(1 + rate / 100, day);
    values.push({day, balance, profit: balance - principal, daily: balance - values[day - 1].balance});
  }
  return {principal, rate, days, values, change: (values[days].balance / principal - 1) * 100};
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('fund-scenarios');
  if (root) initFundScenarios(root);
}

function initFundScenarios(root) {
  const $ = selector => root.querySelector(selector);
  const money = value => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2,
    ...(Math.abs(value) >= 1e12 ? {notation: 'scientific'} : {})
  }).format(Math.abs(value) < .000001 ? 0 : value);
  const percentage = value => (value > 0 ? '+' : '') + new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 2, ...(Math.abs(value) >= 1e6 ? {notation: 'scientific'} : {})
  }).format(Math.abs(value) < .000001 ? 0 : value) + '%';
  const signedMoney = value => (value > 0 ? '+' : '') + money(value);
  const axisMoney = value => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', maximumFractionDigits: 1,
    notation: Math.abs(value) >= 1e12 ? 'scientific' : 'compact'
  }).format(Math.abs(value) < .000001 ? 0 : value);
  const svgNS = 'http://www.w3.org/2000/svg';
  const svgElement = (name, attrs) => {
    const element = document.createElementNS(svgNS, name);
    for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
    return element;
  };
  let scenarios = [], selectedDay = 7;
  const chart = {left: 58, right: 476, top: 16, bottom: 172};
  const feedback = $('#fundCalculatorFeedback');

  function inspect(day) {
    selectedDay = Math.max(0, Math.min(scenarios[0].days, day));
    for (const scenario of scenarios) {
      const panel = $('[data-fund="' + scenario.principal + '"]');
      const point = scenario.values[selectedDay], x = scenario.x(selectedDay), y = scenario.y(point.profit);
      panel.querySelector('.fund-day-label').textContent = 'DAY ' + String(selectedDay).padStart(2, '0');
      panel.querySelector('.fund-daily-profit').textContent = signedMoney(point.daily);
      panel.querySelector('.fund-day-balance').textContent = money(point.balance);
      const cursor = panel.querySelector('.fund-chart-cursor');
      cursor.setAttribute('x1', x); cursor.setAttribute('x2', x);
      const dot = panel.querySelector('.fund-chart-dot');
      dot.setAttribute('cx', x); dot.setAttribute('cy', y);
      const svg = panel.querySelector('.fund-chart');
      svg.setAttribute('aria-valuenow', selectedDay);
      svg.setAttribute('aria-valuetext', 'Day ' + selectedDay + ': balance ' + money(point.balance) + ', daily change ' + signedMoney(point.daily));
    }
  }

  function render() {
    const rateInput = $('#fundDailyRate'), daysInput = $('#fundDuration');
    if (!rateInput.checkValidity() || !daysInput.checkValidity()) {
      feedback.textContent = 'Use −100% to 100% and a period of 1–90 whole days.';
      return;
    }
    const rate = Number(rateInput.value), days = Number(daysInput.value);
    if (!rateInput.value.trim() || !daysInput.value.trim()) return;
    feedback.textContent = '';
    $('#fundDailySlider').value = rate; $('#fundDurationSlider').value = days;
    $('#fundDailySlider').style.setProperty('--range-fill', (rate + 100) / 2 + '%');
    $('#fundDurationSlider').style.setProperty('--range-fill', (days - 1) / 89 * 100 + '%');
    root.querySelectorAll('[data-fund-days]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.fundDays) === days)));
    scenarios = [100, 200].map(principal => calculateFundScenario(principal, rate, days));
    const extent = scenarios[1].values[days].profit;
    const margin = Math.max(Math.abs(extent) * .1, 1);
    const min = Math.min(0, extent) - margin, max = Math.max(0, extent) + margin;
    const y = profit => chart.bottom - (profit - min) / (max - min) * (chart.bottom - chart.top);
    const x = day => chart.left + day / days * (chart.right - chart.left);
    const change = scenarios[0].change;
    const magnitude = Math.max(10, Math.abs(change));
    const power = Math.pow(10, Math.floor(Math.log10(magnitude)));
    const scale = [1, 2.5, 5, 10].map(n => n * power).find(n => n >= magnitude) || power * 10;

    for (const scenario of scenarios) {
      scenario.x = x; scenario.y = y;
      const panel = $('[data-fund="' + scenario.principal + '"]');
      panel.dataset.direction = change < 0 ? 'negative' : 'positive';
      const ending = scenario.values[days];
      panel.querySelector('.fund-ending-value').textContent = money(ending.balance);
      panel.querySelector('.fund-ending-label').textContent = 'Scenario balance · day ' + days;
      panel.querySelector('.fund-total-profit').textContent = signedMoney(ending.profit);
      panel.querySelector('.fund-change-value').textContent = percentage(change);
      const meter = panel.querySelector('.fund-percentage-meter');
      meter.setAttribute('aria-valuemin', change < 0 ? -scale : 0);
      meter.setAttribute('aria-valuemax', change < 0 ? 0 : scale);
      meter.setAttribute('aria-valuenow', change);
      meter.setAttribute('aria-valuetext', percentage(change) + ' over ' + days + ' days');
      meter.querySelector('span').style.width = Math.abs(change) / scale * 100 + '%';
      panel.querySelector('.fund-meter-scale').textContent = 'Scale: ' + (change < 0 ? percentage(-scale) + ' to 0%' : '0% to ' + percentage(scale).replace('+', ''));
      const svg = panel.querySelector('.fund-chart');
      svg.setAttribute('aria-valuemax', days);
      const line = scenario.values.map(point => [x(point.day), y(point.profit)].join(' '));
      panel.querySelector('.fund-chart-line').setAttribute('d', 'M ' + line.join(' L '));
      panel.querySelector('.fund-chart-area').setAttribute('d', 'M ' + x(0) + ' ' + y(0) + ' L ' + line.join(' L ') + ' L ' + x(days) + ' ' + y(0) + ' Z');
      const grid = panel.querySelector('.fund-chart-grid'); grid.replaceChildren();
      for (const tick of [0, extent / 2, extent].filter((value, index, all) => all.indexOf(value) === index)) {
        grid.append(svgElement('line', {x1: chart.left, x2: chart.right, y1: y(tick), y2: y(tick), class: tick === 0 ? 'fund-zero-line' : ''}));
        const label = svgElement('text', {x: chart.left - 9, y: y(tick) + 4, 'text-anchor': 'end'});
        label.textContent = axisMoney(tick); grid.append(label);
      }
      panel.querySelector('.fund-chart-end-day').textContent = 'DAY ' + days;
    }
    inspect(days);
    $('#fundCalculationSummary').textContent = percentage(rate) + ' assumed daily change · ' + days + (days === 1 ? ' day' : ' days') + ' · Daily compounding';
    if ($('#fundDailyBreakdown').open) renderBreakdown();
  }

  function renderBreakdown() {
    const body = $('#fundDailyRows'); body.replaceChildren();
    for (let day = 0; day <= scenarios[0].days; day++) {
      const row = document.createElement('tr');
      const values = [day, ...scenarios.flatMap(scenario => [money(scenario.values[day].balance), signedMoney(scenario.values[day].daily)])];
      for (let index = 0; index < values.length; index++) {
        const cell = document.createElement(index === 0 ? 'th' : 'td');
        if (index === 0) cell.scope = 'row'; cell.textContent = values[index]; row.append(cell);
      }
      body.append(row);
    }
  }
  $('#fundCalculator').addEventListener('submit', event => {event.preventDefault(); render()});
  for (const [sliderId, inputId] of [['fundDailySlider', 'fundDailyRate'], ['fundDurationSlider', 'fundDuration']]) {
    $('#' + sliderId).addEventListener('input', event => {$('#' + inputId).value = event.target.value; render()});
    $('#' + inputId).addEventListener('input', render);
  }
  root.querySelectorAll('[data-fund-days]').forEach(button => button.addEventListener('click', () => {$('#fundDuration').value = button.dataset.fundDays; render()}));
  $('#fundScenarioReset').addEventListener('click', () => {$('#fundDailyRate').value = 1; $('#fundDuration').value = 7; render()});
  $('#fundDailyBreakdown').addEventListener('toggle', () => {if ($('#fundDailyBreakdown').open) renderBreakdown()});
  for (const svg of root.querySelectorAll('.fund-chart')) {
    function track(event) {
      const bounds = svg.getBoundingClientRect();
      const relativeX = (event.clientX - bounds.left) / bounds.width * 500;
      inspect(Math.round((relativeX - chart.left) / (chart.right - chart.left) * scenarios[0].days));
    }
    svg.addEventListener('pointermove', track);
    svg.addEventListener('pointerdown', track);
    svg.addEventListener('pointerleave', () => inspect(scenarios[0].days));
    svg.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      inspect(event.key === 'Home' ? 0 : event.key === 'End' ? scenarios[0].days : selectedDay + (['ArrowRight', 'ArrowUp'].includes(event.key) ? 1 : -1));
    });
  }
  render();
}
