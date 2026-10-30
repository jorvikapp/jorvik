// iPhones and iPads, which handle a few things their own way: pushes, and picking files.
export function isAppleTouchDevice(): boolean {
    const userAgent = navigator.userAgent;
    // iPads ask for the desktop site, so they say Macintosh but have a touch screen.
    return /iPhone|iPad|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && navigator.maxTouchPoints > 1);
}
