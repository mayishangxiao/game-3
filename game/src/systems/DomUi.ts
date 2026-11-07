/**
 * DOM 游戏内文字层 —— 把对话框/HUD 的中文从 canvas 搬到 HTML。
 *
 * 背景：canvas 后缓冲固定 480×270，手机高 dpr 屏上被浏览器硬拉到 2000+ 物理像素，
 * canvas 里的中文全糊。DOM 文字由浏览器按物理像素直接渲染，清晰锐利（就是微信自己
 * 的「横屏」按钮那种效果）。
 *
 * #dom-ui 挂在 #game-root 里，CSS 旋转 90° 时它跟着转；尺寸/位置每帧对齐 canvas，
 * 这样百分比定位就和游戏坐标系对应（480×270 逻辑）。
 */

let ui: HTMLDivElement | null = null;
let dlg: HTMLDivElement | null = null;
let dlgName: HTMLDivElement | null = null;
let dlgBody: HTMLDivElement | null = null;
let dlgHint: HTMLDivElement | null = null;
let hudScene: HTMLDivElement | null = null;
let hudObjective: HTMLDivElement | null = null;
let hudPanel: HTMLDivElement | null = null;
let hudDetail: HTMLDivElement | null = null;
let hudDynasty: HTMLDivElement | null = null;
let hudLevel: HTMLDivElement | null = null;
let hudWeapon: HTMLDivElement | null = null;
let toast: HTMLDivElement | null = null;
let toastTimer: number | null = null;
let title: HTMLDivElement | null = null;
let titleHint: HTMLDivElement | null = null;
let float: HTMLDivElement | null = null;
let overlay: HTMLDivElement | null = null;

function ensure(): void {
  if (ui) return;
  ui = document.getElementById('dom-ui') as HTMLDivElement | null;
  if (!ui) return;
  dlg = ui.querySelector('#dom-dialogue') as HTMLDivElement;
  dlgName = ui.querySelector('#dom-dlg-name') as HTMLDivElement;
  dlgBody = ui.querySelector('#dom-dlg-body') as HTMLDivElement;
  dlgHint = ui.querySelector('#dom-dlg-hint') as HTMLDivElement;
  hudScene = ui.querySelector('#dom-hud-scene') as HTMLDivElement;
  hudObjective = ui.querySelector('#dom-hud-objective') as HTMLDivElement;
  hudPanel = ui.querySelector('#dom-hud-panel') as HTMLDivElement;
  hudDetail = ui.querySelector('#dom-hud-detail') as HTMLDivElement;
  hudDynasty = ui.querySelector('#dom-hud-dynasty') as HTMLDivElement;
  hudLevel = ui.querySelector('#dom-hud-level') as HTMLDivElement;
  hudWeapon = ui.querySelector('#dom-hud-weapon') as HTMLDivElement;
  toast = ui.querySelector('#dom-toast') as HTMLDivElement;
  title = ui.querySelector('#dom-title') as HTMLDivElement;
  titleHint = ui.querySelector('#dom-title-hint') as HTMLDivElement;
  float = ui.querySelector('#dom-float') as HTMLDivElement;
  overlay = ui.querySelector('#dom-overlay') as HTMLDivElement;
}

/** 每帧/每次 resize 时把 #dom-ui 对齐到 canvas 的实际盒。 */
export function syncDomUiToCanvas(canvas: HTMLCanvasElement): void {
  ensure();
  if (!ui) return;
  // canvas 相对 #game-root 的偏移
  const root = canvas.parentElement as HTMLElement | null;
  if (!root) return;
  ui.style.left = `${canvas.offsetLeft}px`;
  ui.style.top = `${canvas.offsetTop}px`;
  ui.style.width = `${canvas.clientWidth}px`;
  ui.style.height = `${canvas.clientHeight}px`;
  scaleOverlay();
}

export function showDialogue(): void {
  ensure();
  if (dlg) dlg.style.display = 'block';
}

export function hideDialogue(): void {
  ensure();
  if (dlg) dlg.style.display = 'none';
}

export function setDialogueSpeaker(speaker: string, hasPortrait: boolean): void {
  ensure();
  if (!dlgName || !dlgBody) return;
  dlgName.textContent = speaker;
  // 有立绘时文字从 20% 开始（给立绘让位）；旁白从左边开始
  const pad = hasPortrait ? '18%' : '0';
  dlgName.style.paddingLeft = pad;
  dlgBody.style.paddingLeft = pad;
  dlgName.style.display = speaker ? 'block' : 'none';
}

export function setDialogueBody(text: string): void {
  ensure();
  if (dlgBody) dlgBody.textContent = text;
}

export function setDialogueTyping(typing: boolean): void {
  ensure();
  if (dlgHint) dlgHint.style.opacity = typing ? '0.35' : '1';
}

export function setHudScene(head: string, year: string, detail: string): void {
  ensure();
  if (!hudPanel || !hudScene || !hudDetail) return;
  const has = !!(head || year);
  hudPanel.style.display = has ? 'block' : 'none';
  hudScene.textContent = year ? `${head}  ${year}` : head;
  hudScene.style.display = head ? 'block' : 'none';
  hudDetail.textContent = detail;
  hudDetail.style.display = detail ? 'block' : 'none';
}

export function setHudObjective(text: string): void {
  ensure();
  if (!hudObjective) return;
  hudObjective.style.display = text ? 'block' : 'none';
  hudObjective.textContent = text;
}

export function setHudDynasty(text: string, defeated: boolean): void {
  ensure();
  if (!hudDynasty) return;
  hudDynasty.style.display = text ? 'block' : 'none';
  hudDynasty.textContent = defeated ? `${text} 战败` : text;
  hudDynasty.style.color = defeated ? '#E85C4A' : '#F0C419';
}

export function setHudLevel(text: string): void {
  ensure();
  if (!hudLevel) return;
  hudLevel.style.display = text ? 'block' : 'none';
  hudLevel.textContent = text;
}

export function setHudWeapon(text: string): void {
  ensure();
  if (!hudWeapon) return;
  hudWeapon.style.display = text ? 'block' : 'none';
  hudWeapon.textContent = text;
}

export function showToast(text: string, ms: number): void {
  ensure();
  if (!toast) return;
  toast.textContent = text;
  toast.style.display = 'block';
  if (toastTimer) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    if (toast) toast.style.display = 'none';
  }, ms);
}

export function setHudVisible(v: boolean): void {
  ensure();
  const nodes = [hudPanel, hudObjective, hudLevel, hudWeapon, hudDynasty];
  for (const n of nodes) {
    if (!n) continue;
    n.style.visibility = v ? 'visible' : 'hidden';
  }
}

export function showTitle(): void {
  ensure();
  if (title) title.style.display = 'block';
}

export function hideTitle(): void {
  ensure();
  if (title) title.style.display = 'none';
}

export function setTitleHint(text: string): void {
  ensure();
  if (titleHint) titleHint.textContent = text;
}

/** 浮动标签（NPC/物件头顶的名字）：sx/sy 是 #dom-ui 内的像素坐标 */
export function showFloat(text: string, sx: number, sy: number): void {
  ensure();
  if (!float) return;
  float.style.display = 'block';
  float.style.left = `${sx}px`;
  float.style.top = `${sy}px`;
  float.textContent = text;
}

export function moveFloat(sx: number, sy: number): void {
  ensure();
  if (!float || float.style.display === 'none') return;
  float.style.left = `${sx}px`;
  float.style.top = `${sy}px`;
}

export function hideFloat(): void {
  ensure();
  if (float) float.style.display = 'none';
}

/** 全屏覆盖层：html 用 480×270 逻辑坐标绝对定位，自动按画布缩放 */
export function showOverlay(html: string): void {
  ensure();
  if (!overlay) return;
  overlay.innerHTML = html;
  overlay.style.display = 'block';
  scaleOverlay();
}

export function hideOverlay(): void {
  ensure();
  if (overlay) {
    overlay.style.display = 'none';
    overlay.innerHTML = '';
  }
  // 清掉场景级浮动标签（章节门等直接挂在 #dom-ui 下的元素）
  document
    .querySelectorAll('#dom-ui > div:not(#dom-title):not(#dom-dialogue):not(#dom-hud):not(#dom-toast):not(#dom-overlay):not(#dom-float)')
    .forEach((el) => el.remove());
}

function scaleOverlay(): void {
  if (!overlay) return;
  const canvas = document.querySelector('#game-root canvas') as HTMLCanvasElement | null;
  const cssW = canvas?.clientWidth ?? 480;
  const s = cssW / 480;
  overlay.style.width = '480px';
  overlay.style.height = '270px';
  overlay.style.transform = `scale(${s})`;
  overlay.style.transformOrigin = 'top left';
}
