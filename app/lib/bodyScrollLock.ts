/**
 * Централизованная блокировка скролла `document.body`: несколько оверлеев/шитов
 * накладываются друг на друга; «снимок» overflow на каждом unmount ломает порядок
 * и даёт залипание `overflow: hidden` или наоборот прокрутку под модалкой.
 */
let bodyScrollLockDepth = 0;
let savedBodyOverflow = "";

export function acquireBodyScrollLock(): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  if (bodyScrollLockDepth === 0) {
    savedBodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLockDepth += 1;

  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (typeof document === "undefined") return;
    bodyScrollLockDepth = Math.max(0, bodyScrollLockDepth - 1);
    if (bodyScrollLockDepth === 0) {
      document.body.style.overflow = savedBodyOverflow;
    }
  };
}
