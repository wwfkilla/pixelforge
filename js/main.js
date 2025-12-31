console.log("main.js execution start");
window.addEventListener('DOMContentLoaded', () => {
    console.log("DOMContentLoaded fired");
    window.editor = new PixelEditor();
    
    try {
        if (typeof SolanaManager !== 'undefined') {
            window.solanaManager = new SolanaManager(window.editor);
        } else {
            console.warn("SolanaManager class not found.");
        }
    } catch (e) {
        console.error("Failed to initialize SolanaManager:", e);
    }

    // Register Service Worker for PWA
    if ('serviceWorker' in navigator) {
        window.addEventListener('load', () => {
            navigator.serviceWorker.register('./sw.js')
                .then(reg => console.log('Service Worker registered:', reg.scope))
                .catch(err => console.log('Service Worker registration failed:', err));
        });
    }
});