const devToolsKeys = new Set(['KeyC', 'KeyI', 'KeyJ']);
if (navigator.userAgent.includes('Firefox/')) devToolsKeys.add('KeyK');
let notice;

function isDevToolsShortcut(event) {
  const { altKey, code, ctrlKey, metaKey, shiftKey } = event;
  if (code === 'F12') return !altKey && !ctrlKey && !metaKey && !shiftKey;
  if (!devToolsKeys.has(code)) return false;
  return (ctrlKey && shiftKey && !altKey && !metaKey) ||
    (metaKey && !ctrlKey && ((altKey && !shiftKey) || (!altKey && shiftKey && code === 'KeyC')));
}

function createNotice() {
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-labelledby', 'devtools-notice-title');
  dialog.setAttribute('aria-describedby', 'devtools-notice-description');
  dialog.innerHTML = `
    <div class="dialog-heading"><h2 id="devtools-notice-title">Close Developer Tools</h2></div>
    <form method="dialog" class="dialog-form">
      <p id="devtools-notice-description">If Inspect or the Console opened, close it before continuing with UmeWorld.</p>
      <div class="dialog-actions"><button class="button primary" autofocus>Continue</button></div>
    </form>`;
  // Let the dialog handle Escape before UmeWorld's chat shortcuts see it.
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') event.stopPropagation();
  });
  document.body.append(dialog);
  return dialog;
}

window.addEventListener('keydown', (event) => {
  if (event.repeat || event.isComposing || !isDevToolsShortcut(event)) return;
  if (typeof HTMLDialogElement === 'undefined' || !HTMLDialogElement.prototype.showModal) return;
  event.preventDefault();
  notice ??= createNotice();
  if (!notice.open) notice.showModal();
}, { capture: true });
