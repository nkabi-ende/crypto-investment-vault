document.addEventListener('submit', async event => {
 const form=event.target;
 if (!(form instanceof HTMLFormElement) || !form.matches('.owner-action')) return;
 event.preventDefault();
 const fields=Object.fromEntries(new FormData(form));
 if(!window.confirm(form.dataset.label+' for '+form.dataset.account+'? New value: '+(fields.value||'Remove attribution')))return;
 const output=form.querySelector('output'), button=form.querySelector('button');
 button.disabled=true;
 try {
  const response=await fetch('/api/admin/operations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(fields)});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||'Action failed');
  location.reload();
 } catch(error){output.textContent=error.message;button.disabled=false}
 finally{form.elements.password.value=''}
});
