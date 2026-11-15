// Operations that return a whole database must not race a newer user save.
// Project autosave remains editable; its existing flush queue drains inside each transaction.
export function stateTransactionBusy(ctx) { return Boolean(ctx.ui?.stateTransactionBusy); }
const otherBusy = (ctx,{allowSoftwareUpdate=false}={}) => Boolean(ctx.ui?.libraryRestoreBusy || ctx.ui?.fullRestoring || (!allowSoftwareUpdate&&ctx.ui?.softwareUpdating) || ctx.ui?.projectManagementBusy || ctx.ui?.projectCommitBusy);
export async function runStateTransaction(ctx, label, operation, options = {}) {
  if (stateTransactionBusy(ctx) || otherBusy(ctx,options)) throw Error('正在处理本次资料，请等待完成后再操作。');
  // Finish native text editing before the busy guard blocks its blur commit.
  globalThis.document?.activeElement?.blur?.();
  if (stateTransactionBusy(ctx) || otherBusy(ctx,options)) throw Error('正在处理本次资料，请等待完成后再操作。');
  ctx.ui.stateTransactionBusy = true;
  const doc = globalThis.document;
  const roots = [...(doc?.querySelectorAll('.rail,.workspace,#modal') || [])].map(node => [node, Boolean(node.inert), node.getAttribute('aria-busy')]);
  const controls = [...(doc?.querySelectorAll('.rail button,.workspace button,.workspace input,.workspace textarea,.workspace select,#modal button,#modal input,#modal textarea,#modal select') || [])].map(node => [node, node.disabled]);
  const dialog = doc?.querySelector('#modal'), cancel = event => event.preventDefault();
  let status;
  try {
    for (const [node] of roots) { node.inert = true; node.setAttribute('aria-busy', 'true'); }
    for (const [node] of controls) node.disabled = true;
    dialog?.addEventListener('cancel', cancel, true);
    if (doc?.body) { status = doc.createElement('div'); status.className = 'toast'; status.dataset.stateTransactionStatus = ''; status.setAttribute('role','status'); status.textContent = label + '，请稍候…'; doc.body.append(status); }
    return await operation();
  } finally {
    ctx.ui.stateTransactionBusy = false;
    dialog?.removeEventListener('cancel', cancel, true);
    status?.remove();
    for (const [node, disabled] of controls) if (node.isConnected) node.disabled = disabled;
    for (const [node, inert, busy] of roots) if (node.isConnected) {
      // Restore dialog ownership exactly: update/restore owners manage only the
      // background roots. Leaving their lock on this shared dialog would make
      // every later confirmation inert after the owner clears its own roots.
      const blocked = node !== dialog && otherBusy(ctx);
      node.inert = inert || blocked;
      if (blocked) node.setAttribute('aria-busy','true');
      else if (busy === null) node.removeAttribute('aria-busy'); else node.setAttribute('aria-busy',busy);
    }
  }
}