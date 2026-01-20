(function () {
    function downloadTextFile(filename, mimeType, text) {
        const safeName = filename || 'export.txt';
        const type = mimeType || 'text/plain;charset=utf-8';
        const blob = new Blob([text ?? ''], { type });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = safeName;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // Revoke async to avoid issues in some browsers.
        setTimeout(() => URL.revokeObjectURL(url), 0);
    }

    window.appInterop = {
        downloadTextFile
    };
})();
