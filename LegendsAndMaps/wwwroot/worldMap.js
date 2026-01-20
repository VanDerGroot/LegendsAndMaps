(function () {
    const MIN_ZOOM = 1;
    const MAX_ZOOM = 8;
    const ZOOM_STEP = 1.25;

    function normalizeCountryId(rawId) {
        if (!rawId) return null;
        const trimmed = String(rawId).trim();
        if (!trimmed) return null;

        // Wikimedia BlankMap uses ISO-3166 alpha-2 lowercase ids.
        // Keep this permissive (2-3 letters) to allow future SVG swaps.
        const match = trimmed.match(/^[A-Za-z]{2,3}$/);
        if (!match) return null;
        return trimmed.toUpperCase();
    }

    function canonicalizeCountryId(rawId, validTwoLetterIds) {
        const id = normalizeCountryId(rawId);
        if (!id) return null;

        if (id.length === 3) {
            const base2 = id.slice(0, 2);
            if (validTwoLetterIds && validTwoLetterIds.has && validTwoLetterIds.has(base2)) {
                return base2;
            }
        }

        return id;
    }

    function findCountryIdFromTarget(target, svgRoot) {
        let el = target;
        while (el && el !== svgRoot && el instanceof Element) {
            if (el.id) {
                const id = normalizeCountryId(el.id);
                if (id) return id;
            }
            el = el.parentElement;
        }
        return null;
    }

    function applyColors(svgRoot, colorsById) {
        if (!svgRoot) return;

        const defaultFill = '#e9ecef';
        const defaultStroke = '#adb5bd';

        // Most countries are <g id="xx"> containing one or more <path>.
        const countryGroups = svgRoot.querySelectorAll('g[id]');
        countryGroups.forEach((g) => {
            const countryId = normalizeCountryId(g.id);
            if (!countryId) return;

            const base2 = (countryId.length === 3) ? countryId.slice(0, 2) : null;

            let color = defaultFill;
            if (colorsById) {
                color = colorsById[countryId] || (base2 ? colorsById[base2] : null) || defaultFill;
            }
            if (color && window.CSS && CSS.supports && !CSS.supports('color', color)) {
                color = defaultFill;
            }

            g.style.cursor = 'pointer';
            g.querySelectorAll('path').forEach((p) => {
                p.style.fill = color;
                p.style.stroke = defaultStroke;
                p.style.strokeWidth = '0.5';
            });
        });

        // Fallback: some SVGs might have countries as <path id="XX"> directly.
        const countryPaths = svgRoot.querySelectorAll('path[id]');
        countryPaths.forEach((p) => {
            const countryId = normalizeCountryId(p.id);
            if (!countryId) return;

            const base2 = (countryId.length === 3) ? countryId.slice(0, 2) : null;

            let color = defaultFill;
            if (colorsById) {
                color = colorsById[countryId] || (base2 ? colorsById[base2] : null) || defaultFill;
            }
            if (color && window.CSS && CSS.supports && !CSS.supports('color', color)) {
                color = defaultFill;
            }
            p.style.cursor = 'pointer';
            p.style.fill = color;
            p.style.stroke = defaultStroke;
            p.style.strokeWidth = '0.5';
        });
    }

    function applyHidden(svgRoot, hiddenIds) {
        if (!svgRoot) return;

        const hiddenSet = new Set((hiddenIds || []).map(normalizeCountryId).filter(Boolean));

        const countryGroups = svgRoot.querySelectorAll('g[id]');
        countryGroups.forEach((g) => {
            const countryId = normalizeCountryId(g.id);
            if (!countryId) return;

            const base2 = (countryId.length === 3) ? countryId.slice(0, 2) : null;
            const isHidden = hiddenSet.has(countryId) || (base2 && hiddenSet.has(base2));

            g.style.display = isHidden ? 'none' : '';
        });

        const countryPaths = svgRoot.querySelectorAll('path[id]');
        countryPaths.forEach((p) => {
            const countryId = normalizeCountryId(p.id);
            if (!countryId) return;

            const base2 = (countryId.length === 3) ? countryId.slice(0, 2) : null;
            const isHidden = hiddenSet.has(countryId) || (base2 && hiddenSet.has(base2));

            p.style.display = isHidden ? 'none' : '';
        });
    }

    const instances = new Map();

    function createTooltipElement() {
        const el = document.createElement('div');
        el.className = 'world-map-tooltip';
        el.style.position = 'fixed';
        el.style.left = '0px';
        el.style.top = '0px';
        el.style.display = 'none';
        el.style.pointerEvents = 'none';
        el.style.zIndex = '9999';
        el.style.padding = '4px 8px';
        el.style.borderRadius = '6px';
        el.style.background = 'rgba(0,0,0,0.78)';
        el.style.color = '#fff';
        el.style.font = '12px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
        el.style.whiteSpace = 'nowrap';
        el.style.boxShadow = '0 2px 12px rgba(0,0,0,0.25)';
        document.body.appendChild(el);
        return el;
    }

    function hideTooltip(instance) {
        if (!instance || !instance.tooltipEl) return;
        instance.tooltipEl.style.display = 'none';
        instance.tooltipEl.textContent = '';
        instance.lastHoverId = null;
    }

    function positionTooltip(instance, clientX, clientY) {
        const el = instance.tooltipEl;
        if (!el) return;

        const padding = 8;
        let x = clientX + 12;
        let y = clientY + 12;

        // Clamp within viewport.
        const rect = el.getBoundingClientRect();
        if (x + rect.width + padding > window.innerWidth) {
            x = clientX - rect.width - 12;
        }
        if (y + rect.height + padding > window.innerHeight) {
            y = clientY - rect.height - 12;
        }

        x = Math.max(padding, Math.min(window.innerWidth - rect.width - padding, x));
        y = Math.max(padding, Math.min(window.innerHeight - rect.height - padding, y));

        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    }

    function sanitizeInlineSvg(svgRoot) {
        if (!svgRoot || !(svgRoot instanceof Element)) {
            return;
        }

        function sanitizeCssText(cssText) {
            if (!cssText) return '';

            let text = String(cssText);

            // Strip any @import rules.
            text = text.replace(/@import[^;]*;/gi, '');

            // Disallow external url(...) references. Keep url(#id) for internal SVG references.
            text = text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (match, quote, value) => {
                const v = String(value || '').trim();
                if (v.startsWith('#')) {
                    return `url(${v})`;
                }
                return 'none';
            });

            return text;
        }

        // Remove elements that can execute script or embed foreign content.
        const dangerousSelectors = [
            'script',
            'foreignObject',
            'iframe',
            'object',
            'embed',
            'link',
            'meta'
        ].join(',');

        try {
            svgRoot.querySelectorAll(dangerousSelectors).forEach(el => el.remove());
        } catch {
            // ignore
        }

        // Keep <style> (this SVG relies on it for ocean/land defaults), but sanitize its content.
        try {
            svgRoot.querySelectorAll('style').forEach((styleEl) => {
                const original = styleEl.textContent || '';
                const sanitized = sanitizeCssText(original);
                styleEl.textContent = sanitized;
            });
        } catch {
            // ignore
        }

        // Remove inline event handlers and suspicious hrefs.
        // (CSP should also block inline handlers, but we sanitize defensively.)
        const all = svgRoot.querySelectorAll('*');
        all.forEach((el) => {
            // Strip on* attributes.
            for (const attr of Array.from(el.attributes || [])) {
                const name = String(attr.name || '');
                if (name && name.toLowerCase().startsWith('on')) {
                    try { el.removeAttribute(name); } catch { }
                }
            }

            // Remove external resource references.
            const href = el.getAttribute('href') || el.getAttribute('xlink:href');
            if (href) {
                const value = String(href).trim();
                const lower = value.toLowerCase();
                const isExternal =
                    lower.startsWith('http:') ||
                    lower.startsWith('https:') ||
                    lower.startsWith('//') ||
                    lower.startsWith('data:') ||
                    lower.startsWith('javascript:');

                if (isExternal) {
                    try { el.removeAttribute('href'); } catch { }
                    try { el.removeAttribute('xlink:href'); } catch { }
                }
            }
        });

    }

    function clamp(value, min, max) {
        return Math.max(min, Math.min(max, value));
    }

    function installZoomPan(container, svgRoot, dotNetRef) {
        // We use CSS transforms on the <svg> element for simplicity.
        // This keeps hit-testing intact, and works well with pointer events.
        svgRoot.style.transformOrigin = '0 0';
        svgRoot.style.touchAction = 'none';

        const state = {
            scale: 1,
            tx: 0,
            ty: 0,
            pointers: new Map(),
            dragging: false,
            dragMoved: false,
            suppressClickUntil: 0,
            // For single-pointer drag.
            lastX: 0,
            lastY: 0,
            // For pinch.
            pinchStartDist: 0,
            pinchStartScale: 1,
            pinchStartTx: 0,
            pinchStartTy: 0,
            pinchWorldX: 0,
            pinchWorldY: 0,

            zoomNotifyPending: false,
            lastNotifiedScale: null,
        };

        function notifyZoomChanged() {
            if (!dotNetRef || !dotNetRef.invokeMethodAsync) {
                return;
            }

            // Throttle zoom notifications to one per animation frame.
            if (state.zoomNotifyPending) {
                return;
            }

            state.zoomNotifyPending = true;
            requestAnimationFrame(async () => {
                state.zoomNotifyPending = false;

                // Round to reduce chatty updates.
                const rounded = Math.round(state.scale * 1000) / 1000;
                if (state.lastNotifiedScale === rounded) {
                    return;
                }

                state.lastNotifiedScale = rounded;
                try {
                    await dotNetRef.invokeMethodAsync('OnZoomChanged', rounded);
                } catch {
                    // ignore
                }
            });
        }

        function applyTransform() {
            svgRoot.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${state.scale})`;

            if (state.scale > 1) {
                container.style.cursor = state.dragging ? 'grabbing' : 'grab';
            } else {
                container.style.cursor = '';
            }

            notifyZoomChanged();
        }

        function toWorld(clientX, clientY) {
            const rect = container.getBoundingClientRect();
            const x = clientX - rect.left;
            const y = clientY - rect.top;
            return {
                x: (x - state.tx) / state.scale,
                y: (y - state.ty) / state.scale,
                screenX: x,
                screenY: y
            };
        }

        function zoomAt(clientX, clientY, newScale) {
            const world = toWorld(clientX, clientY);
            state.scale = clamp(newScale, MIN_ZOOM, MAX_ZOOM);

            if (state.scale <= 1) {
                state.scale = 1;
                state.tx = 0;
                state.ty = 0;
                applyTransform();
                return;
            }

            state.tx = world.screenX - world.x * state.scale;
            state.ty = world.screenY - world.y * state.scale;
            applyTransform();
        }

        function zoomBy(factor) {
            const rect = container.getBoundingClientRect();
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            zoomAt(cx, cy, state.scale * factor);
        }

        function reset() {
            state.scale = 1;
            state.tx = 0;
            state.ty = 0;
            applyTransform();
        }

        const onWheel = (evt) => {
            // Trackpad pinch often comes through as wheel events; zoom on wheel always.
            evt.preventDefault();

            // deltaY > 0 means zoom out.
            const zoomIntensity = 0.002;
            const delta = -evt.deltaY * zoomIntensity;
            const factor = Math.exp(delta);
            const target = state.scale * factor;
            zoomAt(evt.clientX, evt.clientY, target);
        };

        const onPointerDown = (evt) => {
            // Left mouse button or touch/pen.
            if (evt.pointerType === 'mouse' && evt.button !== 0) {
                return;
            }

            // Only capture the pointer when we might be dragging/zooming.
            // Pointer capture can interfere with click target resolution, so keep it minimal.
            if (state.scale > 1 || evt.pointerType !== 'mouse') {
                try {
                    container.setPointerCapture(evt.pointerId);
                } catch {
                    // ignore
                }
            }
            state.pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });

            if (state.pointers.size === 1) {
                state.dragging = state.scale > 1;
                state.dragMoved = false;
                state.lastX = evt.clientX;
                state.lastY = evt.clientY;
                applyTransform();
            }

            if (state.pointers.size === 2) {
                // Pinch zoom init.
                const pts = Array.from(state.pointers.values());
                const dx = pts[0].x - pts[1].x;
                const dy = pts[0].y - pts[1].y;
                state.pinchStartDist = Math.hypot(dx, dy) || 1;
                state.pinchStartScale = state.scale;
                state.pinchStartTx = state.tx;
                state.pinchStartTy = state.ty;

                const midX = (pts[0].x + pts[1].x) / 2;
                const midY = (pts[0].y + pts[1].y) / 2;
                const world = toWorld(midX, midY);
                state.pinchWorldX = world.x;
                state.pinchWorldY = world.y;

                state.dragging = false;
                state.dragMoved = true; // prevent click when doing pinch.
            }
        };

        const onPointerMove = (evt) => {
            if (!state.pointers.has(evt.pointerId)) {
                return;
            }

            state.pointers.set(evt.pointerId, { x: evt.clientX, y: evt.clientY });

            if (state.pointers.size === 2) {
                const pts = Array.from(state.pointers.values());
                const dx = pts[0].x - pts[1].x;
                const dy = pts[0].y - pts[1].y;
                const dist = Math.hypot(dx, dy) || 1;
                const ratio = dist / state.pinchStartDist;
                const targetScale = clamp(state.pinchStartScale * ratio, MIN_ZOOM, MAX_ZOOM);

                if (targetScale <= 1) {
                    state.scale = 1;
                    state.tx = 0;
                    state.ty = 0;
                    applyTransform();
                    return;
                }

                // Keep the pinch midpoint anchored in world space.
                const midX = (pts[0].x + pts[1].x) / 2;
                const midY = (pts[0].y + pts[1].y) / 2;
                const rect = container.getBoundingClientRect();
                const screenX = midX - rect.left;
                const screenY = midY - rect.top;

                state.scale = targetScale;
                state.tx = screenX - state.pinchWorldX * state.scale;
                state.ty = screenY - state.pinchWorldY * state.scale;
                applyTransform();
                return;
            }

            if (!state.dragging || state.scale <= 1) {
                return;
            }

            const dx = evt.clientX - state.lastX;
            const dy = evt.clientY - state.lastY;
            state.lastX = evt.clientX;
            state.lastY = evt.clientY;

            if (Math.abs(dx) + Math.abs(dy) > 2) {
                state.dragMoved = true;
            }

            state.tx += dx;
            state.ty += dy;
            applyTransform();
        };

        const onPointerUpOrCancel = (evt) => {
            if (state.pointers.has(evt.pointerId)) {
                state.pointers.delete(evt.pointerId);
            }

            if (state.pointers.size === 0) {
                if (state.dragMoved) {
                    state.suppressClickUntil = Date.now() + 250;
                }
                state.dragging = false;
                state.dragMoved = false;
                applyTransform();
            }
        };

        // Keep click-to-select working, but suppress clicks immediately after a drag/pinch.
        const shouldSuppressClick = () => Date.now() < state.suppressClickUntil;

        container.addEventListener('wheel', onWheel, { passive: false });
        container.addEventListener('pointerdown', onPointerDown);
        container.addEventListener('pointermove', onPointerMove);
        container.addEventListener('pointerup', onPointerUpOrCancel);
        container.addEventListener('pointercancel', onPointerUpOrCancel);

        applyTransform();

        return {
            shouldSuppressClick,
            getScale: () => state.scale,
            zoomIn: () => zoomBy(ZOOM_STEP),
            zoomOut: () => zoomBy(1 / ZOOM_STEP),
            reset,
            dispose: () => {
                try { container.removeEventListener('wheel', onWheel); } catch { }
                try { container.removeEventListener('pointerdown', onPointerDown); } catch { }
                try { container.removeEventListener('pointermove', onPointerMove); } catch { }
                try { container.removeEventListener('pointerup', onPointerUpOrCancel); } catch { }
                try { container.removeEventListener('pointercancel', onPointerUpOrCancel); } catch { }
            }
        };
    }

    async function init(containerId, dotNetRef, svgUrl) {
        const container = document.getElementById(containerId);
        if (!container) throw new Error(`worldMap.init: container not found: ${containerId}`);

        const url = svgUrl || '/data/world.svg';
        const res = await fetch(url);
        if (!res.ok) throw new Error(`worldMap.init: failed to fetch SVG: ${res.status}`);

        const svgText = await res.text();

        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svgRoot = doc && doc.documentElement;
        if (!svgRoot || svgRoot.nodeName.toLowerCase() !== 'svg') {
            throw new Error('worldMap.init: SVG root not found');
        }

        sanitizeInlineSvg(svgRoot);

        // Remove <title> elements so the browser doesn't show its own tooltip.
        // (We provide our own tooltip with group name.)
        try {
            svgRoot.querySelectorAll('title').forEach(t => t.remove());
        } catch {
            // ignore
        }

        // Replace any existing content with the sanitized SVG.
        container.replaceChildren(svgRoot);

        // Make it responsive.
        svgRoot.removeAttribute('width');
        svgRoot.removeAttribute('height');
        svgRoot.style.width = '100%';
        svgRoot.style.height = 'auto';

        const zoomPan = installZoomPan(container, svgRoot, dotNetRef);

        // Precompute which 2-letter ids exist in this SVG so we can map sub-ids (e.g. cnx -> cn).
        const validTwoLetterIds = new Set();
        try {
            svgRoot.querySelectorAll('g[id], path[id]').forEach((el) => {
                const id = normalizeCountryId(el.id);
                if (id && id.length === 2) {
                    validTwoLetterIds.add(id);
                }
            });
        } catch {
            // ignore
        }

        const tooltipEl = createTooltipElement();

        const onClick = async (evt) => {
            if (zoomPan && zoomPan.shouldSuppressClick && zoomPan.shouldSuppressClick()) {
                return;
            }

            // With pointer capture (during panning), click events may target the container.
            // Resolve the real element under the cursor instead.
            const hit = document.elementFromPoint(evt.clientX, evt.clientY);
            const raw = findCountryIdFromTarget(hit || evt.target, svgRoot);
            const id = canonicalizeCountryId(raw, validTwoLetterIds);
            if (!id) return;
            try {
                await dotNetRef.invokeMethodAsync('OnCountryClicked', id);
            } catch {
                // ignore
            }
        };

        container.addEventListener('click', onClick);

        const onPointerMoveTooltip = (evt) => {
            const instance = instances.get(containerId);
            if (!instance) return;

            // Don't show tooltips while dragging or on touch.
            if (evt.pointerType === 'touch' || (evt.buttons && evt.buttons !== 0)) {
                hideTooltip(instance);
                return;
            }

            const hit = document.elementFromPoint(evt.clientX, evt.clientY);
            const raw = findCountryIdFromTarget(hit || evt.target, svgRoot);
            const id = canonicalizeCountryId(raw, instance.validTwoLetterIds);
            if (!id) {
                hideTooltip(instance);
                return;
            }

            if (instance.hiddenSet && instance.hiddenSet.has(id)) {
                hideTooltip(instance);
                return;
            }

            const groupName = (instance.groupById && instance.groupById[id]) ? String(instance.groupById[id]) : 'No data';
            if (!groupName) {
                hideTooltip(instance);
                return;
            }

            if (instance.lastHoverId !== id) {
                tooltipEl.textContent = groupName;
                tooltipEl.style.display = 'block';
                instance.lastHoverId = id;
            }

            positionTooltip(instance, evt.clientX, evt.clientY);
        };

        const onPointerLeaveTooltip = () => {
            const instance = instances.get(containerId);
            if (!instance) return;
            hideTooltip(instance);
        };

        const onPointerDownTooltip = () => {
            const instance = instances.get(containerId);
            if (!instance) return;
            hideTooltip(instance);
        };

        container.addEventListener('pointermove', onPointerMoveTooltip);
        container.addEventListener('pointerleave', onPointerLeaveTooltip);
        container.addEventListener('pointerdown', onPointerDownTooltip);

        instances.set(containerId, {
            container,
            svgRoot,
            dotNetRef,
            onClick,
            onPointerMoveTooltip,
            onPointerLeaveTooltip,
            onPointerDownTooltip,
            tooltipEl,
            zoomPan,
            hiddenIds: []
            ,
            hiddenSet: new Set(),
            groupById: {},
            lastHoverId: null,
            validTwoLetterIds
        });

        applyColors(svgRoot, {});
        applyHidden(svgRoot, []);
    }

    function setColors(containerId, colorsById) {
        const instance = instances.get(containerId);
        if (!instance) return;
        applyColors(instance.svgRoot, colorsById || {});
    }

    function setHidden(containerId, hiddenIds) {
        const instance = instances.get(containerId);
        if (!instance) return;
        instance.hiddenIds = Array.isArray(hiddenIds) ? hiddenIds : [];
        instance.hiddenSet = new Set((instance.hiddenIds || []).map(normalizeCountryId).filter(Boolean));
        applyHidden(instance.svgRoot, instance.hiddenIds);
    }

    function setGroups(containerId, groupById) {
        const instance = instances.get(containerId);
        if (!instance) return;

        const src = (groupById && typeof groupById === 'object') ? groupById : {};
        const normalized = {};
        for (const k of Object.keys(src)) {
            const id = canonicalizeCountryId(k, instance.validTwoLetterIds);
            if (!id) continue;
            normalized[id] = String(src[k] ?? '');
        }
        instance.groupById = normalized;

        // If the currently hovered country changed group, update text.
        if (instance.tooltipEl && instance.tooltipEl.style.display !== 'none' && instance.lastHoverId) {
            const name = instance.groupById[instance.lastHoverId] || 'No data';
            instance.tooltipEl.textContent = name;
        }
    }

    function zoomIn(containerId) {
        const instance = instances.get(containerId);
        if (!instance || !instance.zoomPan || !instance.zoomPan.zoomIn) return;
        instance.zoomPan.zoomIn();
    }

    function zoomOut(containerId) {
        const instance = instances.get(containerId);
        if (!instance || !instance.zoomPan || !instance.zoomPan.zoomOut) return;
        instance.zoomPan.zoomOut();
    }

    function resetZoom(containerId) {
        const instance = instances.get(containerId);
        if (!instance || !instance.zoomPan || !instance.zoomPan.reset) return;
        instance.zoomPan.reset();
    }

    function getZoom(containerId) {
        const instance = instances.get(containerId);
        if (!instance || !instance.zoomPan || !instance.zoomPan.getScale) return 1;
        return instance.zoomPan.getScale();
    }

    function exportPng(containerId, defaultBaseName) {
        const instance = instances.get(containerId);
        if (!instance || !instance.svgRoot) {
            return;
        }

        // Back-compat: exportPng(containerId, "name")
        // New: exportPng(containerId, { defaultName, includeLegend, legendItems })
        let options = null;
        if (defaultBaseName && typeof defaultBaseName === 'object') {
            options = defaultBaseName;
            defaultBaseName = options.defaultName;
        }

        const now = new Date();
        const pad2 = (n) => String(n).padStart(2, '0');
        const timestamp = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}_${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
        const suggested = (defaultBaseName && String(defaultBaseName).trim()) ? String(defaultBaseName).trim() : `map_${timestamp}`;

        const nameInput = window.prompt('Map name (PNG):', suggested);
        if (nameInput === null) {
            return; // cancelled
        }

        let base = String(nameInput).trim();
        if (!base) {
            base = suggested;
        }

        // Basic filename sanitization.
        base = base.replace(/[\\/\?%\*:|"<>]/g, '-').replace(/\s+/g, ' ').trim();
        if (!base) {
            base = suggested;
        }

        const fileName = base.toLowerCase().endsWith('.png') ? base : `${base}.png`;

        const svgRoot = instance.svgRoot;
        const rect = svgRoot.getBoundingClientRect();
        const width = Math.max(1, Math.round(rect.width));
        const height = Math.max(1, Math.round(rect.height));

        // Clone SVG and remove CSS transforms (export the canonical map, not the current pan/zoom view).
        const clone = svgRoot.cloneNode(true);
        try {
            clone.style.transform = '';
            clone.style.transformOrigin = '';
        } catch {
            // ignore
        }

        function drawLegendOnCanvas(ctx, width, height, legendItems, titleText) {
            if (!legendItems || !Array.isArray(legendItems)) {
                return;
            }

            const items = legendItems
                .filter(x => x && typeof x.name === 'string' && x.name.trim().length > 0)
                .slice(0, 30);

            if (items.length === 0) {
                return;
            }

            const margin = 12;
            const padding = 12;
            const swatch = 12;
            const gap = 8;
            const lineH = 18;
            const titleH = 20;

            const title = (titleText && String(titleText).trim()) ? String(titleText).trim() : 'Legend';
            const fontTitle = '600 14px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
            const fontItem = '13px system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';

            ctx.save();

            // Measure widths.
            ctx.font = fontTitle;
            let maxTextWidth = ctx.measureText(title).width;
            ctx.font = fontItem;
            for (const it of items) {
                const w = ctx.measureText(it.name).width;
                if (w > maxTextWidth) maxTextWidth = w;
            }

            let boxWidth = Math.ceil(padding + swatch + gap + maxTextWidth + padding);
            let boxHeight = Math.ceil(padding + titleH + items.length * lineH + padding);

            // Keep it within the image.
            boxWidth = Math.min(boxWidth, width - margin * 2);
            boxHeight = Math.min(boxHeight, height - margin * 2);

            const x = margin;
            const y = Math.max(margin, height - margin - boxHeight);

            // Background.
            ctx.fillStyle = 'rgba(255,255,255,0.92)';
            ctx.strokeStyle = 'rgba(0,0,0,0.15)';
            ctx.lineWidth = 1;

            const r = 10;
            ctx.beginPath();
            ctx.moveTo(x + r, y);
            ctx.arcTo(x + boxWidth, y, x + boxWidth, y + boxHeight, r);
            ctx.arcTo(x + boxWidth, y + boxHeight, x, y + boxHeight, r);
            ctx.arcTo(x, y + boxHeight, x, y, r);
            ctx.arcTo(x, y, x + boxWidth, y, r);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();

            // Title.
            ctx.fillStyle = 'rgba(0,0,0,0.85)';
            ctx.font = fontTitle;
            ctx.textBaseline = 'alphabetic';
            ctx.fillText(title, x + padding, y + padding + 14);

            // Items.
            ctx.font = fontItem;
            for (let i = 0; i < items.length; i++) {
                const it = items[i];
                const itemY = y + padding + titleH + i * lineH;

                // Swatch.
                ctx.fillStyle = it.color || '#808080';
                ctx.fillRect(x + padding, itemY + 2, swatch, swatch);
                ctx.strokeStyle = 'rgba(0,0,0,0.2)';
                ctx.strokeRect(x + padding + 0.5, itemY + 2.5, swatch - 1, swatch - 1);

                // Label.
                ctx.fillStyle = 'rgba(0,0,0,0.85)';
                ctx.fillText(it.name, x + padding + swatch + gap, itemY + 13);
            }

            ctx.restore();
        }

        // Ensure xmlns for standalone serialization.
        if (!clone.getAttribute('xmlns')) {
            clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
        }
        if (!clone.getAttribute('xmlns:xlink')) {
            clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
        }

        // Set explicit size for rasterization.
        clone.setAttribute('width', String(width));
        clone.setAttribute('height', String(height));

        // Add a white background.
        try {
            const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bg.setAttribute('x', '0');
            bg.setAttribute('y', '0');
            bg.setAttribute('width', '100%');
            bg.setAttribute('height', '100%');
            bg.setAttribute('fill', '#ffffff');
            clone.insertBefore(bg, clone.firstChild);
        } catch {
            // ignore
        }

        // Legend is drawn in canvas-space after rasterization (more reliable than SVG-space).

        const svgText = new XMLSerializer().serializeToString(clone);
        const svgBlob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);

        const img = new Image();
        img.onload = () => {
            const dpr = window.devicePixelRatio || 1;
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * dpr));
            canvas.height = Math.max(1, Math.round(height * dpr));

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                URL.revokeObjectURL(url);
                return;
            }

            // White background, then SVG.
            ctx.save();
            ctx.scale(dpr, dpr);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);

            if (options && options.includeLegend) {
                const legendTitle = (options.legendTitle && String(options.legendTitle).trim()) ? String(options.legendTitle).trim() : base;
                drawLegendOnCanvas(ctx, width, height, options.legendItems, legendTitle);
            }
            ctx.restore();

            canvas.toBlob((blob) => {
                URL.revokeObjectURL(url);
                if (!blob) return;

                const pngUrl = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = pngUrl;
                a.download = fileName;
                a.style.display = 'none';
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(pngUrl), 0);
            }, 'image/png');
        };

        img.onerror = () => {
            URL.revokeObjectURL(url);
        };

        img.src = url;
    }

    function dispose(containerId) {
        const instance = instances.get(containerId);
        if (!instance) return;

        try {
            instance.container.removeEventListener('click', instance.onClick);
        } catch {
            // ignore
        }

        try {
            instance.container.removeEventListener('pointermove', instance.onPointerMoveTooltip);
            instance.container.removeEventListener('pointerleave', instance.onPointerLeaveTooltip);
            instance.container.removeEventListener('pointerdown', instance.onPointerDownTooltip);
        } catch {
            // ignore
        }

        try {
            hideTooltip(instance);
            if (instance.tooltipEl && instance.tooltipEl.parentNode) {
                instance.tooltipEl.parentNode.removeChild(instance.tooltipEl);
            }
        } catch {
            // ignore
        }

        try {
            instance.zoomPan && instance.zoomPan.dispose && instance.zoomPan.dispose();
        } catch {
            // ignore
        }

        try {
            instance.dotNetRef && instance.dotNetRef.dispose && instance.dotNetRef.dispose();
        } catch {
            // ignore
        }

        instances.delete(containerId);
    }

    window.worldMap = {
        init,
        setColors,
        setGroups,
        setHidden,
        zoomIn,
        zoomOut,
        resetZoom,
        getZoom,
        exportPng,
        dispose
    };
})();
