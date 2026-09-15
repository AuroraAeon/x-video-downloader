const boundary = 'article,[data-testid="tweet"],[role="dialog"],main,body';
const extensionNode = (node: Element) => node.tagName.startsWith("XVD-");
const outOfFlow = (style: CSSStyleDeclaration) =>
  ["absolute", "fixed"].includes(style.position);

function specifiedHeight(node: HTMLElement): boolean {
  const typed = (
    node as HTMLElement & {
      computedStyleMap?: () => {
        get: (name: string) => { toString(): string } | undefined;
      };
    }
  )
    .computedStyleMap?.()
    .get("height")
    ?.toString();
  return !!typed && typed !== "auto";
}

// A sibling can be a player's overlay/spacer, but never a caption or action row.
function mediaOnlyParent(
  parent: HTMLElement,
  child: HTMLElement,
  bounds: DOMRect,
): boolean {
  return [...parent.childNodes].every((node) => {
    if (node === child || node.nodeType === Node.COMMENT_NODE) return true;
    if (node.nodeType === Node.TEXT_NODE) return !node.textContent?.trim();
    if (
      !(node instanceof HTMLElement) ||
      extensionNode(node) ||
      ["SCRIPT", "STYLE"].includes(node.tagName)
    )
      return true;
    const r = node.getBoundingClientRect();
    if (!r.width || !r.height) return true;
    return (
      r.top >= bounds.top - 2 &&
      r.bottom <= bounds.bottom + 2 &&
      r.left >= bounds.left - 2 &&
      r.right <= bounds.right + 2
    );
  });
}

export function videoPlacement(
  video: HTMLVideoElement,
): { buttonFrame: HTMLElement; infoAnchor: HTMLElement } | undefined {
  const bounds = video.getBoundingClientRect();
  if (!video.parentElement || !bounds.width || !bounds.height) return;
  const chain: HTMLElement[] = [];
  for (
    let node: HTMLElement | null = video.parentElement;
    node && !node.matches(boundary) && chain.length < 32;
    node = node.parentElement
  )
    chain.push(node);
  if (!chain.length) return;
  let index = 0,
    buttonFrame = chain[0]!;
  for (let i = 0; i < chain.length; i++) {
    const node = chain[i]!,
      style = getComputedStyle(node),
      box = node.getBoundingClientRect();
    const sameFrame =
      Math.abs(box.width - bounds.width) < 6 &&
      Math.abs(box.height - bounds.height) < 6;
    if (sameFrame && node.querySelectorAll("video").length === 1)
      buttonFrame = node;
    // Leave every absolute layer and fixed aspect/height shell before inserting flow content.
    if (
      outOfFlow(style) ||
      specifiedHeight(node) ||
      style.aspectRatio !== "auto" ||
      (sameFrame && /hidden|clip/.test(`${style.overflowX} ${style.overflowY}`))
    )
      index = i;
  }
  while (index < chain.length - 1) {
    const anchor = chain[index]!,
      parent = chain[index + 1]!,
      style = getComputedStyle(parent);
    const horizontal =
      style.display.includes("flex") &&
      !style.flexDirection.startsWith("column");
    if (
      outOfFlow(getComputedStyle(anchor)) ||
      horizontal ||
      style.display.includes("grid") ||
      mediaOnlyParent(parent, anchor, bounds)
    )
      index++;
    else break;
  }
  const infoAnchor = chain[index]!;
  if (outOfFlow(getComputedStyle(infoAnchor))) return;
  return { buttonFrame, infoAnchor };
}

export function placeVideoUi(
  video: HTMLVideoElement,
  button: HTMLElement,
  info: HTMLElement,
): boolean {
  const placement = videoPlacement(video);
  if (!placement) return false;
  const { buttonFrame, infoAnchor } = placement;
  if (button.parentElement !== buttonFrame) {
    if (getComputedStyle(buttonFrame).position === "static")
      buttonFrame.style.position = "relative";
    buttonFrame.append(button);
  }
  // Multiple videos sharing one fixed grid put their strips after that grid, in DOM order.
  let previous: Element = infoAnchor;
  while (
    previous.nextElementSibling?.tagName === "XVD-QUALITY" &&
    previous.nextElementSibling !== info
  )
    previous = previous.nextElementSibling;
  if (previous.nextElementSibling !== info) previous.after(info);
  return true;
}
