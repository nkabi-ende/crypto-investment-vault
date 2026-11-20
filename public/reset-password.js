const resetToken = location.hash.slice(1);
if (location.hash) history.replaceState(null, '', location.pathname);

const requestForm = document.querySelector('#requestReset');
const completeForm = document.querySelector('#completeReset');
const message = document.querySelector('#resetMessage');
const description = document.querySelector('#resetHelp');
const title = document.querySelector('#resetTitle');
const newLink = document.querySelector('#newResetLink');
const emailField = document.querySelector('#resetEmail');
const newPassword = document.querySelector('#newPassword');
const confirmPassword = document.querySelector('#confirmPassword');
const completing = /^[A-Za-z0-9_-]{43}$/.test(resetToken);

requestForm.hidden = completing;
completeForm.hidden = !completing;
if (completing) {
 title.textContent = 'Choose a new password';
 description.textContent = 'Use 12–128 characters. You’ll sign in again after the change.';
} else if (resetToken) {
 message.textContent = 'This link is invalid. Request a new one below.';
}

async function submitReset(form, path, payload, onSuccess) {
 const button = form.querySelector('button');
 if (button.disabled) return;
 button.disabled = true;
 form.setAttribute('aria-busy', 'true');
 message.textContent = '';
 message.removeAttribute('data-error');
 try {
  const response = await fetch('/api/auth/password-reset/' + path, {
   method: 'POST',
   headers: {'Content-Type': 'application/json'},
   body: JSON.stringify(payload),
   signal: AbortSignal.timeout(20000)
  });
  const result = await response.json();
  if (!response.ok || !result.ok) {
   if (completing && response.status === 400) newLink.hidden = false;
   throw new Error(result.error || 'Password reset is temporarily unavailable.');
  }
  onSuccess();
 } catch (error) {
  message.dataset.error = '';
  message.textContent = error instanceof SyntaxError || error.name === 'TimeoutError'
   ? 'Password reset is temporarily unavailable. Please try again.'
   : error.message;
 } finally {
  button.disabled = false;
  form.removeAttribute('aria-busy');
 }
}

requestForm.addEventListener('submit', event => {
 event.preventDefault();
 void submitReset(requestForm, 'request', {email: emailField.value}, () => {
  message.textContent = 'If this email belongs to a CIV account, a reset link will arrive shortly.';
 });
});
completeForm.addEventListener('submit', event => {
 event.preventDefault();
 if (newPassword.value !== confirmPassword.value) {
  message.dataset.error = '';
  message.textContent = 'The passwords must match.';
  confirmPassword.focus();
  return;
 }
 void submitReset(completeForm, 'confirm', {token: resetToken, password: newPassword.value}, () => {
  completeForm.reset();
  completeForm.hidden = true;
  title.textContent = 'Password updated';
  description.textContent = 'Sign in to CIV with your new password.';
  newLink.hidden = true;
  message.textContent = 'Your other CIV sessions have been signed out.';
 });
});

for (const form of [requestForm, completeForm]) form.querySelector('button').disabled = false;
