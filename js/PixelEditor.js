/**
 * Main Application Logic
 */
class PixelEditor {
    constructor() {
        // State
        this.gridWidth = 32;
        this.gridHeight = 32;
        this.gridSize = 32; // Kept for some legacy square calculations
        this.pixelScale = 20; // Will be calculated
        this.frames = []; // Array of arrays of ImageData/Canvas
        this.currentFrameIndex = 0;
        this.layers = []; // Metadata for layers { visible, opacity, name, x, y }
        this.currentLayerIndex = 0;
        this.history = []; // Undo stack
        this.historyIndex = -1;
        this.isPlaying = false;
        this.fps = 12;
        this.loopMode = 'loop'; // loop, pingpong, once
        this.playDirection = 1; // 1 for forward, -1 for backward
        this.tool = 'pencil';
        this.color = '#000000';
        this.secondaryColor = '#ffffff';
        this.brushSize = 1;
        this.ditherPattern = '50';
        this.ditherUseSecondary = false;
        this.isDrawing = false;
        this.symmetry = 'none';
        this.showGrid = true;
        this.onionSkin = false;
        this.onionSkinPrev = 1;
        this.onionSkinNext = 1;
        this.fillShapes = false;
        this.zoom = 1.0;
        this.pixelPerfect = false;
        this.smoothing = 0;
        
        // Independent Tool Settings
        this.pencilSettings = { size: 1, pixelPerfect: false, smoothing: 0 };
        this.eraserSettings = { size: 1, pixelPerfect: false, smoothing: 0 };
        
        this.smoothPos = { x: 0, y: 0 };
        this.strokePath = []; // Track points for pixel-perfect
        this.isAddingToSelection = false; // Capture shift state at start of drag
        this.selection = null; // Map for selection mask
        this.hasSelection = false;
        this.isDirty = false; // Flag to track if state needs saving
        this.clipboard = null; // Stored pixels for copy/paste
        this.lassoPath = []; // Path for lasso tool
        
        // Selection Move State
        this.floatingBuffer = null; // Map for moving pixels: screenIndex -> color
        this.floatingBufferX = 0;
        this.floatingBufferY = 0;
        this.isDraggingSelection = false;
        
        // Drawing State
        this.startX = 0;
        this.startY = 0;
        this.currentX = 0;
        this.currentY = 0;
        
        this.recentColors = [];
        
        // DOM
        this.canvasWrapper = document.getElementById('canvas-wrapper');
        this.gridCanvas = document.getElementById('grid-canvas');
        this.drawingCanvas = document.getElementById('drawing-canvas');
        this.cursorCanvas = document.getElementById('cursor-canvas');
        this.previewCanvas = document.getElementById('preview-canvas');
        
        this.ctxGrid = this.gridCanvas.getContext('2d');
        this.ctxDraw = this.drawingCanvas.getContext('2d');
        this.ctxCursor = this.cursorCanvas.getContext('2d');
        this.ctxPreview = this.previewCanvas.getContext('2d');

        this.init();
    }

    init() {
        // 1. Setup basics that don't depend on data
        this.generatePalette();
        this.renderRecentColors();
        this.setupEventListeners();
        this.updateToolSettingsUI();

        // 2. Try to restore last session silently
        this.loadFromLocal().then(data => {
            if (data && data.frames && data.frames.length > 0) {
                console.log("Auto-restoring last session:", data.name);
                this.deserialize(data);
            } else {
                // 3. Fallback to default fresh state
                this.setupDefaultState();
            }
        }).catch(err => {
            console.error("Auto-load failed, starting fresh.", err);
            this.setupDefaultState();
        });
    }

    setupDefaultState() {
        this.layers = [
            { name: 'Layer 1', visible: true, opacity: 255, x: 0, y: 0 },
            { name: 'Layer 2', visible: true, opacity: 255, x: 0, y: 0 },
            { name: 'Layer 3', visible: true, opacity: 255, x: 0, y: 0 }
        ];
        
        this.addFrame(true); // Init first frame
        this.updateCanvasSize();
        this.render();
        this.updateUI();
        
        this.isDirty = true;
        this.saveState();
    }

    updateCanvasSize() {
        const maxW = window.innerWidth - 300 - 40;
        const maxH = window.innerHeight - 200;
        const rawScale = Math.min(maxW / this.gridWidth, maxH / this.gridHeight);
        this.pixelScale = Math.floor(Math.max(1, Math.min(30, rawScale)) * this.zoom);
        const w = this.gridWidth * this.pixelScale;
        const h = this.gridHeight * this.pixelScale;
        
        [this.gridCanvas, this.drawingCanvas, this.cursorCanvas].forEach(c => {
            c.width = w;
            c.height = h;
        });
        
        this.canvasWrapper.style.width = w + 'px';
        this.canvasWrapper.style.height = h + 'px';
        
        const zoomDisplay = document.getElementById('zoom-display-header');
        if (zoomDisplay) zoomDisplay.innerText = Math.round(this.zoom * 100) + '%';

        this.drawGrid();
        this.render();
    }

    drawGrid() {
        const ctx = this.ctxGrid;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        if (!this.showGrid) return;
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)';
        ctx.beginPath();
        for (let i = 0; i <= this.gridWidth; i++) {
            const p = i * this.pixelScale;
            ctx.moveTo(p, 0); ctx.lineTo(p, ctx.canvas.height);
        }
        for (let i = 0; i <= this.gridHeight; i++) {
            const p = i * this.pixelScale;
            ctx.moveTo(0, p); ctx.lineTo(ctx.canvas.width, p);
        }
        ctx.stroke();
    }

    generatePalette() {
        const colors = [
            '#000000', '#1d2b53', '#7e2553', '#008751', '#ab5236', '#5f574f', '#c2c3c7', '#fff1e8',
            '#ff004d', '#ffa300', '#ffec27', '#00e436', '#29adff', '#83769c', '#ff77a8', '#ffccaa',
            '#222034', '#45283c', '#663931', '#8f563b', '#df7126', '#d9a066', '#eec39a', '#fbf236',
            '#99e550', '#6abe30', '#37946e', '#4b692f', '#524b24', '#323c39', '#3f3f74', '#306082'
        ];
        const container = document.getElementById('palette-container');
        if (!container) {
            this.setColor('#000000');
            this.setSecondaryColor('#ffffff');
            return;
        }
        container.innerHTML = '';
        colors.forEach(c => {
            const div = document.createElement('div');
            div.className = 'color-swatch';
            div.style.backgroundColor = c;
            div.onclick = () => this.setColor(c);
            div.oncontextmenu = (e) => {
                e.preventDefault();
                this.setSecondaryColor(c);
            };
            container.appendChild(div);
        });
        this.setColor(colors[0]);
        this.setSecondaryColor('#ffffff');
    }

    setColor(color) {
        this.color = color;
        document.getElementById('custom-color-picker').value = color;
        document.getElementById('primary-color-view').style.backgroundColor = color;
        document.getElementById('hex-display').innerText = color.toUpperCase();
        document.querySelectorAll('.color-swatch').forEach(el => {
            el.classList.toggle('active', el.style.backgroundColor === color || this.rgbToHex(el.style.backgroundColor) === color);
        });
        
        // Add to recent colors
        if (!this.recentColors.includes(color)) {
            this.recentColors.unshift(color);
            if (this.recentColors.length > 16) this.recentColors.pop();
            this.renderRecentColors();
        } else {
            // Move to front if already exists
            const idx = this.recentColors.indexOf(color);
            this.recentColors.splice(idx, 1);
            this.recentColors.unshift(color);
            this.renderRecentColors();
        }
    }

    renderRecentColors() {
        const container = document.getElementById('recent-colors-list');
        if (!container) return;
        container.innerHTML = '';
        this.recentColors.forEach(c => {
            const div = document.createElement('div');
            div.className = 'recent-color-swatch';
            div.style.backgroundColor = c;
            div.onclick = () => this.setColor(c);
            container.appendChild(div);
        });
    }

    showToast(message, type = 'primary') {
        const container = document.getElementById('toast-container');
        if (!container) return;
        
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        
        let icon = 'ℹ️';
        if (type === 'success') icon = '✅';
        if (type === 'danger') icon = '⚠️';
        
        toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;
        container.appendChild(toast);
        
        setTimeout(() => {
            toast.classList.add('fade-out');
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }

    setSecondaryColor(color) {
        this.secondaryColor = color;
        document.getElementById('secondary-color-picker').value = color;
        document.getElementById('secondary-color-view').style.backgroundColor = color;
    }

    swapColors() {
        const temp = this.color;
        this.setColor(this.secondaryColor);
        this.setSecondaryColor(temp);
    }

    rgbToHex(rgb) {
        if(!rgb) return '#000000';
        if(rgb.startsWith('#')) return rgb;
        const rgbMatch = rgb.match(/\d+/g);
        if(!rgbMatch) return '#000000';
        return "#" + ((1 << 24) + (parseInt(rgbMatch[0]) << 16) + (parseInt(rgbMatch[1]) << 8) + parseInt(rgbMatch[2])).toString(16).slice(1);
    }

    selectTool(tool) {
        if (this.tool === 'move' && this.floatingBuffer) {
            this.commitMoveSelection();
        }

        // Save current settings to the previous tool
        if (this.tool === 'pencil') {
            this.pencilSettings = { size: this.brushSize, pixelPerfect: this.pixelPerfect, smoothing: this.smoothing };
        } else if (this.tool === 'eraser') {
            this.eraserSettings = { size: this.brushSize, pixelPerfect: this.pixelPerfect, smoothing: this.smoothing };
        }

        this.tool = tool;

        // Load settings for the new tool
        if (this.tool === 'pencil') {
            this.brushSize = this.pencilSettings.size;
            this.pixelPerfect = this.pencilSettings.pixelPerfect;
            this.smoothing = this.pencilSettings.smoothing;
        } else if (this.tool === 'eraser') {
            this.brushSize = this.eraserSettings.size;
            this.pixelPerfect = this.eraserSettings.pixelPerfect;
            this.smoothing = this.eraserSettings.smoothing;
        }

        document.querySelectorAll('.tool-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tool === tool);
        });

        // Update active selection tool icon if a sub-tool is selected
        const selectionGroupBtn = document.getElementById('active-selection-tool');
        if (selectionGroupBtn && ['select', 'lasso', 'wand'].includes(tool)) {
            if (tool === 'select') {
                selectionGroupBtn.innerHTML = '<div style="width: 16px; height: 16px; border: 1.5px dashed #fff; border-radius: 2px;"></div>';
                selectionGroupBtn.title = "Selection (S)";
            } else if (tool === 'lasso') {
                selectionGroupBtn.innerHTML = '🔗';
                selectionGroupBtn.title = "Lasso (L)";
            } else if (tool === 'wand') {
                selectionGroupBtn.innerHTML = '🪄';
                selectionGroupBtn.title = "Magic Wand (W)";
            }
            selectionGroupBtn.classList.add('active');
            selectionGroupBtn.dataset.tool = tool;
        }

        this.updateCursorClass();
        this.updateToolSettingsUI();
        this.syncToolSettingsUI();
    }

    syncToolSettingsUI() {
        const brushSizeSlider = document.getElementById('gen-brush-size-slider');
        const brushSizeDisplay = document.getElementById('gen-brush-size-display');
        const pixelPerfectToggle = document.getElementById('pixel-perfect-toggle');
        const smoothingSlider = document.getElementById('smoothing-slider');
        const smoothingDisplay = document.getElementById('smoothing-display');

        if (brushSizeSlider) {
            brushSizeSlider.value = this.brushSize;
            if (brushSizeDisplay) brushSizeDisplay.innerText = this.brushSize;
        }
        if (pixelPerfectToggle) pixelPerfectToggle.checked = this.pixelPerfect;
        if (smoothingSlider) {
            smoothingSlider.value = this.smoothing;
            if (smoothingDisplay) smoothingDisplay.innerText = this.smoothing;
        }
    }

    /* --- Drawing Logic --- */

    createEmptyLayerData() {
        return new Map(); 
    }

    addFrame(isInit = false) {
        const frame = [];
        for(let i=0; i<this.layers.length; i++) {
            frame.push(this.createEmptyLayerData());
        }
        this.frames.push(frame);
        if (!isInit) {
            this.currentFrameIndex = this.frames.length - 1;
            this.isDirty = true;
            this.saveState();
            this.updateUI();
            this.render();
            this.showToast("Frame added");
        }
    }

    duplicateFrame() {
        const current = this.frames[this.currentFrameIndex];
        const newFrame = current.map(layerData => new Map(layerData));
        this.frames.splice(this.currentFrameIndex + 1, 0, newFrame);
        this.currentFrameIndex++;
        this.isDirty = true;
        this.saveState();
        this.updateUI();
        this.render();
        this.showToast("Frame duplicated");
    }

    deleteFrame() {
        if (this.frames.length <= 1) return;
        this.frames.splice(this.currentFrameIndex, 1);
        if (this.currentFrameIndex >= this.frames.length) this.currentFrameIndex = this.frames.length - 1;
        this.isDirty = true;
        this.saveState();
        this.updateUI();
        this.render();
        this.showToast("Frame deleted", "danger");
    }

    addLayer(nameOverride = null, dataOverride = null) {
        const name = nameOverride || `Layer ${this.layers.length + 1}`;
        this.layers.unshift({ name, visible: true, opacity: 255, x: 0, y: 0, clipped: false }); 
        this.frames.forEach(frame => {
            let layerData;
            if (dataOverride instanceof Map) {
                layerData = new Map(dataOverride);
            } else if (dataOverride instanceof Uint32Array) {
                layerData = new Map();
                for (let i = 0; i < dataOverride.length; i++) {
                    if (dataOverride[i] !== 0) {
                        const lx = i % this.gridSize;
                        const ly = Math.floor(i / this.gridSize);
                        layerData.set(`${lx},${ly}`, dataOverride[i]);
                    }
                }
            } else {
                layerData = this.createEmptyLayerData();
            }
            frame.unshift(layerData);
        });
        this.currentLayerIndex = 0;
        this.isDirty = true;
        this.saveState();
        this.updateUI();
        this.render();
        this.showToast("Layer added");
    }

    deleteLayer(index) {
        if (this.layers.length <= 1) return;
        this.layers.splice(index, 1);
        this.frames.forEach(frame => frame.splice(index, 1));
        if (this.currentLayerIndex >= this.layers.length) this.currentLayerIndex = this.layers.length - 1;
        this.isDirty = true;
        this.saveState();
        this.updateUI();
        this.render();
        this.showToast("Layer deleted", "danger");
    }

    renameLayer(index) {
        const newName = prompt("Enter new layer name:", this.layers[index].name);
        if (newName && newName !== this.layers[index].name) {
            this.layers[index].name = newName;
            this.isDirty = true;
            this.saveState();
            this.updateUI();
        }
    }

    selectLayerAlpha(idx) {
        const layer = this.layers[idx];
        const frame = this.frames[this.currentFrameIndex][idx];
        this.selection = new Set();
        
        for (const [key, p] of frame) {
            const [lx, ly] = key.split(',').map(Number);
            const sx = lx + layer.x;
            const sy = ly + layer.y;
            this.selection.add(`${sx},${sy}`);
        }
        
        this.hasSelection = this.selection.size > 0;
        this.render();
        this.showToast(`Selected layer content (${this.selection.size} pixels)`);
    }

    /* --- Drawing Logic --- */

    getPixelIndex(x, y) {
        return `${x},${y}`;
    }

    setPixel(x, y, colorInt, layerIdx = this.currentLayerIndex) {
        const layer = this.layers[layerIdx];
        const lx = x - layer.x;
        const ly = y - layer.y;
        
        // Selection Constraint
        if (this.hasSelection) {
            const key = `${x},${y}`;
            if (!this.selection.has(key)) return;
        }

        const frame = this.frames[this.currentFrameIndex][layerIdx];
        const key = `${lx},${ly}`;
        
        if (colorInt === 0) {
            if (frame.has(key)) {
                frame.delete(key);
                this.isDirty = true;
            }
        }
        else {
            if (frame.get(key) !== colorInt) {
                frame.set(key, colorInt);
                this.isDirty = true;
            }
        }
    }

    getPixel(x, y, layerIdx = this.currentLayerIndex) {
        const layer = this.layers[layerIdx];
        const lx = x - layer.x;
        const ly = y - layer.y;
        return this.frames[this.currentFrameIndex][layerIdx].get(`${lx},${ly}`) || 0;
    }

    hexToInt(hex) {
        const r = parseInt(hex.substr(1, 2), 16);
        const g = parseInt(hex.substr(3, 2), 16);
        const b = parseInt(hex.substr(5, 2), 16);
        const a = 255;
        return (a << 24) | (b << 16) | (g << 8) | r;
    }

    applyTool(x, y, isDrag, isShift = false) {
        if (this.tool === 'picker') {
            for(let l=0; l<this.layers.length; l++) {
                if(!this.layers[l].visible) continue;
                const p = this.getPixel(x, y, l);
                if(p !== 0) {
                    const r = p & 0xFF;
                    const g = (p >> 8) & 0xFF;
                    const b = (p >> 16) & 0xFF;
                    const hex = "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
                    this.setColor(hex);
                    this.tool = 'pencil';
                    this.updateUI();
                    return;
                }
            }
            return;
        }

        if (this.tool === 'wand') {
            this.magicWand(x, y, isShift);
            this.drawCursor(x, y); // Update selection visual
            return;
        }

        if (this.tool === 'bucket' && !isDrag) {
            const targetColor = this.getPixel(x, y);
            const fillColor = this.hexToInt(this.color);
            if (targetColor === fillColor) return;
            this.floodFill(x, y, targetColor, fillColor);
            this.saveState();
            this.render();
            return;
        }

        if (this.tool === 'move' || this.tool === 'rectangle' || this.tool === 'ellipse' || this.tool === 'select' || this.tool === 'lasso') return;

        const colorInt = this.tool === 'eraser' ? 0 : this.hexToInt(this.color);
        const secondaryInt = this.hexToInt(this.secondaryColor);
        const size = this.brushSize;

        this.drawLine(this.startX, this.startY, x, y, (lx, ly) => {
            // Pixel Perfect Logic
            if (this.pixelPerfect && size === 1 && (this.tool === 'pencil' || this.tool === 'eraser')) {
                const lastIdx = this.strokePath.length - 1;
                if (lastIdx >= 0) {
                    const last = this.strokePath[lastIdx];
                    if (last.x === lx && last.y === ly) return; // Skip if same pixel
                }
                
                this.strokePath.push({ x: lx, y: ly });
                
                if (this.strokePath.length >= 3) {
                    const p1 = this.strokePath[this.strokePath.length - 3];
                    const p2 = this.strokePath[this.strokePath.length - 2];
                    const p3 = this.strokePath[this.strokePath.length - 1];
                    
                    // If p1 and p3 are neighbors (touching by side or corner), then p2 is a double
                    if (Math.abs(p1.x - p3.x) <= 1 && Math.abs(p1.y - p3.y) <= 1) {
                         // Erase p2 from the frame Map directly to avoid recursive applyTool calls
                         const layerIdx = this.currentLayerIndex;
                         const layer = this.layers[layerIdx];
                         const frame = this.frames[this.currentFrameIndex][layerIdx];
                         frame.delete(`${p2.x - layer.x},${p2.y - layer.y}`);
                         
                         // Remove p2 from history of this stroke
                         this.strokePath.splice(this.strokePath.length - 2, 1);
                    }
                }
            }

            const points = this.getSymmetryPoints(lx, ly);
            points.forEach(sp => {
                // Brush loop
                const radius = Math.floor(size / 2);
                for (let dy = -radius; dy <= radius; dy++) {
                    for (let dx = -radius; dx <= radius; dx++) {
                        const px = sp.x + dx;
                        const py = sp.y + dy;
                        
                        if (this.tool === 'dither') {
                            const isOn = this.shouldDrawDither(px, py);
                            if (isOn) {
                                this.setPixel(px, py, colorInt);
                            } else if (this.ditherUseSecondary) {
                                this.setPixel(px, py, secondaryInt);
                            }
                        } else {
                            this.setPixel(px, py, colorInt);
                        }
                    }
                }
            });
        });
    }

    handleDrawStart(e) {
        if (this.isPlaying) return;
        const pos = this.getPos(e);
        if (this.tool === 'bucket' || this.tool === 'picker' || this.tool === 'wand') {
            this.applyTool(pos.x, pos.y, false, e.shiftKey);
            return;
        }

        this.isAddingToSelection = e.shiftKey;

        if (this.tool === 'select') {
            if (!this.isAddingToSelection && this.isPosInSelection(pos.x, pos.y)) {
                // Clicked inside selection with select tool -> trigger move
                if (!this.floatingBuffer) this.startMoveSelection();
                this.isDraggingSelection = true;
                this.startX = pos.x;
                this.startY = pos.y;
                this.render();
                return;
            }
            if (!this.isAddingToSelection) this.clearSelection();
        }

        if (this.tool === 'lasso') {
            if (!this.isAddingToSelection && this.isPosInSelection(pos.x, pos.y)) {
                // Clicked inside selection with lasso tool -> trigger move
                if (!this.floatingBuffer) this.startMoveSelection();
                this.isDraggingSelection = true;
                this.startX = pos.x;
                this.startY = pos.y;
                this.render();
                return;
            }
            if (!this.isAddingToSelection) this.clearSelection();
            this.isDrawing = true;
            this.lassoPath = [{x: pos.x, y: pos.y}];
            this.startX = pos.x;
            this.startY = pos.y;
            this.currentX = pos.x;
            this.currentY = pos.y;
            return;
        }

        // Selection Move Logic Start
        if (this.tool === 'move' && this.hasSelection) {
            if (!this.floatingBuffer) {
                this.startMoveSelection();
            }
            this.isDraggingSelection = true;
            this.startX = pos.x;
            this.startY = pos.y;
            this.render();
            return;
        }

        this.isDrawing = true;
        this.startX = pos.x;
        this.startY = pos.y;
        this.currentX = pos.x;
        this.currentY = pos.y;
        this.smoothPos = { x: pos.x, y: pos.y };
        this.strokePath = [{ x: pos.x, y: pos.y }];
        
        if (this.tool !== 'move' && this.tool !== 'rectangle' && this.tool !== 'ellipse' && this.tool !== 'select') {
            this.applyTool(pos.x, pos.y, true, e.shiftKey);
        }
    }

    handleDrawMove(e) {
        const pos = this.getPos(e);
        let targetX = pos.x;
        let targetY = pos.y;

        if (this.isDrawing && this.smoothing > 0 && !['move', 'rectangle', 'ellipse', 'select'].includes(this.tool)) {
            const weight = 1 / (this.smoothing + 1);
            this.smoothPos.x += (pos.x - this.smoothPos.x) * weight;
            this.smoothPos.y += (pos.y - this.smoothPos.y) * weight;
            targetX = Math.round(this.smoothPos.x);
            targetY = Math.round(this.smoothPos.y);
        }

        this.currentX = targetX;
        this.currentY = targetY;

        this.updateCursorClass();

        if (!this.isDrawing && !this.isDraggingSelection) {
            this.drawCursor(pos.x, pos.y, e.shiftKey, e.altKey);
            return;
        }
        
        if (this.tool === 'lasso' && this.isDrawing) {
            if (this.lassoPath[this.lassoPath.length - 1].x !== targetX || this.lassoPath[this.lassoPath.length - 1].y !== targetY) {
                this.lassoPath.push({x: targetX, y: targetY});
                this.drawCursor(targetX, targetY);
            }
            return;
        }

        if (this.tool === 'move' || this.isDraggingSelection) {
            const dx = pos.x - this.startX;
            const dy = pos.y - this.startY;
            
            if (this.isDraggingSelection) {
                this.floatingBufferX += dx;
                this.floatingBufferY += dy;
                this.startX = pos.x;
                this.startY = pos.y;
                this.render();
                return;
            }

            if (dx !== 0 || dy !== 0) {
                this.layers[this.currentLayerIndex].x += dx;
                this.layers[this.currentLayerIndex].y += dy;
                this.startX = pos.x;
                this.startY = pos.y;
                this.isDirty = true;
                this.render();
            }
            return;
        }

        if (this.tool === 'rectangle' || this.tool === 'ellipse' || this.tool === 'select') {
            this.drawCursor(targetX, targetY, e.shiftKey, e.altKey);
            return;
        }

        if (targetX !== this.startX || targetY !== this.startY) {
            this.applyTool(targetX, targetY, true, e.shiftKey);
            this.startX = targetX;
            this.startY = targetY;
            this.render();
        }
    }

    handleDrawEnd(e) {
        if (this.isDraggingSelection) {
            this.commitMoveSelection();
            this.render();
            return;
        }

        if (!this.isDrawing) return;
        
        if (this.tool === 'lasso') {
            if (this.lassoPath.length > 2) {
                const pixels = this.getLassoPixels(this.lassoPath);
                if (!this.isAddingToSelection || !this.selection) this.selection = new Set();
                pixels.forEach(p => this.selection.add(`${p.x},${p.y}`));
                this.hasSelection = this.selection.size > 0;
            }
            this.isDrawing = false;
            this.lassoPath = [];
            this.render();
            this.drawCursor(this.currentX, this.currentY);
            return;
        }
        
        if (this.tool === 'rectangle' || this.tool === 'ellipse' || this.tool === 'select') {
            const shift = e ? e.shiftKey : false;
            const alt = e ? e.altKey : false;
            
            const fillBefore = this.fillShapes;
            if (this.tool === 'select') this.fillShapes = true;
            
            const pixels = this.getShapePixels(this.startX, this.startY, this.currentX, this.currentY, this.tool === 'select' ? 'rectangle' : this.tool, shift, alt);
            
            if (this.tool === 'select') {
                this.fillShapes = fillBefore;
                if (!this.isAddingToSelection || !this.selection) {
                    this.selection = new Set();
                }
                pixels.forEach(p => {
                    this.selection.add(`${p.x},${p.y}`);
                });
                this.hasSelection = this.selection.size > 0;
            } else {
                const colorInt = this.hexToInt(this.color);
                pixels.forEach(p => {
                    const sym = this.getSymmetryPoints(p.x, p.y);
                    sym.forEach(sp => this.setPixel(sp.x, sp.y, colorInt));
                });
            }
        }
        
        this.isDrawing = false;
        this.saveState();
        this.render();
        this.drawCursor(this.currentX, this.currentY, e ? e.shiftKey : false, e ? e.altKey : false);
    }

    getShapePixels(x0, y0, x1, y1, tool, shift, alt) {
        let sx = x0, sy = y0;
        let ex = x1, ey = y1;
        if (alt) {
            const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
            sx = x0 - dx; ex = x0 + dx; sy = y0 - dy; ey = y0 + dy;
        }
        if (shift) {
            let w = Math.abs(ex - sx) + 1, h = Math.abs(ey - sy) + 1;
            const max = Math.max(w, h), dirX = ex >= sx ? 1 : -1, dirY = ey >= sy ? 1 : -1;
            ex = sx + (max - 1) * dirX; ey = sy + (max - 1) * dirY;
        }
        const minX = Math.max(-100, Math.min(sx, ex)), maxX = Math.min(this.gridWidth + 100, Math.max(sx, ex)), minY = Math.max(-100, Math.min(sy, ey)), maxY = Math.min(this.gridHeight + 100, Math.max(sy, ey));
        const pixels = [];
        if (tool === 'rectangle') {
            if (this.fillShapes) {
                for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) pixels.push({x, y});
            } else {
                for (let x = minX; x <= maxX; x++) { pixels.push({x, y: minY}); pixels.push({x, y: maxY}); }
                for (let y = minY + 1; y < maxY; y++) { pixels.push({x: minX, y}); pixels.push({x: maxX, y}); }
            }
        } else if (tool === 'ellipse') {
            const rx = (maxX - minX) / 2, ry = (maxY - minY) / 2, cx = minX + rx, cy = minY + ry;
            for (let y = minY; y <= maxY; y++) {
                for (let x = minX; x <= maxX; x++) {
                    const dx = (x - cx), dy = (y - cy);
                    const dist = (dx * dx) / (rx * rx || 0.25) + (dy * dy) / (ry * ry || 0.25);
                    if (dist <= 1.05) {
                        if (this.fillShapes) pixels.push({x, y});
                        else {
                            let isEdge = false;
                            for (let [nx, ny] of [[x+1, y], [x-1, y], [x, y+1], [x, y-1]]) {
                                const nDist = ((nx-cx)**2)/(rx*rx||0.25) + ((ny-cy)**2)/(ry*ry||0.25);
                                if (nDist > 1.05) { isEdge = true; break; }
                            }
                            if (isEdge || rx < 1 || ry < 1) pixels.push({x, y});
                        }
                    }
                }
            }
        }
        return pixels;
    }

    getLassoPixels(path) {
        if (path.length < 3) return [];
        
        // Use a temporary canvas to fill the polygon and read back pixels
        const canvas = document.createElement('canvas');
        canvas.width = this.gridWidth;
        canvas.height = this.gridHeight;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = 'white';
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
            ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.closePath();
        ctx.fill();
        
        const imgData = ctx.getImageData(0, 0, this.gridWidth, this.gridHeight);
        const data = imgData.data;
        const pixels = [];
        
        for (let i = 0; i < data.length / 4; i++) {
            if (data[i * 4] > 128) {
                pixels.push({
                    x: i % this.gridWidth,
                    y: Math.floor(i / this.gridWidth)
                });
            }
        }
        return pixels;
    }

    getPos(e) {
        const rect = this.drawingCanvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const x = Math.floor((clientX - rect.left) / this.pixelScale);
        const y = Math.floor((clientY - rect.top) / this.pixelScale);
        return { x, y };
    }

    getSymmetryPoints(x, y) {
        const points = [{x, y}];
        const w = this.gridWidth, h = this.gridHeight;
        if (this.symmetry === 'horizontal' || this.symmetry === 'radial') points.push({ x: w - 1 - x, y: y });
        if (this.symmetry === 'vertical' || this.symmetry === 'radial') points.push({ x: x, y: h - 1 - y });
        if (this.symmetry === 'radial') points.push({ x: w - 1 - x, y: h - 1 - y });
        return points;
    }

    bresenham(x0, y0, x1, y1, callback) {
        const dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
        const sx = (x0 < x1) ? 1 : -1, sy = (y0 < y1) ? 1 : -1;
        let err = dx - dy;
        while(true) {
            callback(x0, y0);
            if ((x0 === x1) && (y0 === y1)) break;
            const e2 = 2 * err;
            if (e2 > -dy) { err -= dy; x0 += sx; }
            if (e2 < dx) { err += dx; y0 += sy; }
        }
    }

    drawLine(x0, y0, x1, y1, callback) { this.bresenham(x0, y0, x1, y1, callback); }

    floodFill(startX, startY, targetColor, fillColor) {
        const queue = [[startX, startY]];
        const processed = new Set();
        while(queue.length > 0) {
            const [x, y] = queue.pop();
            const key = `${x},${y}`;
            if(processed.has(key)) continue;
            processed.add(key);
            
            // Selection Constraint Check for Flood Fill
            if (this.hasSelection) {
                 if (!this.selection.has(key)) continue;
            }

            if(this.getPixel(x, y) !== targetColor) continue;
            const points = this.getSymmetryPoints(x, y);
            points.forEach(p => this.setPixel(p.x, p.y, fillColor));
            
            // 8-way connectivity (orthogonal + diagonal)
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const nx = x + dx;
                    const ny = y + dy;
                    if(nx >= -100 && nx < this.gridWidth+100 && ny >= -100 && ny < this.gridHeight+100) {
                        queue.push([nx, ny]);
                    }
                }
            }
        }
    }

    magicWand(startX, startY, isShift) {
        if (!isShift || !this.selection) {
            this.selection = new Set();
        }
        
        const targetColor = this.getPixel(startX, startY); // Current layer
        const queue = [[startX, startY]];
        const processed = new Set();
        
        this.hasSelection = true;

        while(queue.length > 0) {
            const [x, y] = queue.pop();
            const key = `${x},${y}`;
            if (processed.has(key)) continue;
            processed.add(key);
            
            if (x < -100 || x >= this.gridWidth + 100 || y < -100 || y >= this.gridHeight + 100) continue;
            if (this.getPixel(x, y) !== targetColor) continue;
            
            this.selection.add(key);
            
            [[x+1, y], [x-1, y], [x, y+1], [x, y-1]].forEach(([nx, ny]) => queue.push([nx, ny]));
        }
    }

    startMoveSelection() {
        // Create Floating Buffer from Selection (Map: screenIndex -> color)
        this.floatingBuffer = new Map();
        const layerIdx = this.currentLayerIndex;
        // 1. Save state BEFORE cutting pixels
        this.isDirty = true;
        this.saveState();

        // 2. Cut pixels
        // We iterate the selection SET. This handles off-screen selection pixels if they exist.
        // Although currently magic wand only selects on-screen, a moved selection can be off-screen.
        const coordsToRemove = [];

        for (const key of this.selection) {
            const [x, y] = key.split(',').map(Number);
            
            // Use getPixel to get the color (handles layer offsets)
            const pixel = this.getPixel(x, y, layerIdx);
            if (pixel !== 0) {
                // We use the coordinate key as the map key for the floating buffer now
                // to support infinite bounds (previously used index)
                this.floatingBuffer.set(key, pixel);
                
                coordsToRemove.push({x, y});
            }
        }
        
        // Clear pixels from layer
        const toolBefore = this.tool;
        const hasSelectionBefore = this.hasSelection;
        this.hasSelection = false; // Temporarily disable selection constraint to clear
        coordsToRemove.forEach(p => {
             this.setPixel(p.x, p.y, 0, layerIdx);
        });
        this.hasSelection = hasSelectionBefore;
        
        this.floatingBufferX = 0;
        this.floatingBufferY = 0;
        this.isDraggingSelection = true;
    }

    commitMoveSelection() {
        if (!this.floatingBuffer) return;

        const layerIdx = this.currentLayerIndex;
        const layerData = this.frames[this.currentFrameIndex][layerIdx];
        const newSelection = new Set();

        // Paste pixels back at new position
        for (const [originalKey, pixel] of this.floatingBuffer) {
            const [sx, sy] = originalKey.split(',').map(Number);
            
            // New Screen Position
            const nx = sx + this.floatingBufferX;
            const ny = sy + this.floatingBufferY;
            const newKey = `${nx},${ny}`;
            
            // Update Selection Mask Position (No bounds check - allows off-canvas selection)
            newSelection.add(newKey);

            // Convert to Layer Local Coords
            const layer = this.layers[layerIdx];
            const lx = nx - layer.x;
            const ly = ny - layer.y;

            // Save to Layer Map (NO BOUNDS CHECK)
            layerData.set(`${lx},${ly}`, pixel);
        }

        this.selection = newSelection;
        this.floatingBuffer = null;
        this.isDraggingSelection = false;
        
        // Save state AFTER move (Moved State)
        this.isDirty = true;
        this.saveState();
    }

    isPosInSelection(x, y) {
        if (!this.hasSelection || !this.selection) return false;
        // If we are currently moving, the selection set contains the original coordinates.
        // We need to account for the floating buffer offset if it exists.
        const ox = this.floatingBuffer ? this.floatingBufferX : 0;
        const oy = this.floatingBuffer ? this.floatingBufferY : 0;
        return this.selection.has(`${x - ox},${y - oy}`);
    }

    clearSelection() {
        this.selection = null;
        this.hasSelection = false;
        this.drawCursor(-1, -1);
    }

    clearLayer() {
        if (!confirm("Clear current layer?")) return;
        this.saveState();
        this.frames[this.currentFrameIndex][this.currentLayerIndex].clear();
        this.render();
        this.isDirty = true;
        this.showToast("Layer cleared", "danger");
    }

    clearCanvas() {
        if (!confirm("Clear all layers in this frame?")) return;
        this.saveState(); 
        this.frames[this.currentFrameIndex].forEach(layerData => layerData.clear());
        this.render();
        this.isDirty = true;
        this.showToast("Canvas cleared", "danger");
    }

    copySelection() {
        if (!this.hasSelection || !this.selection) return;
        
        const pixels = new Map();
        let minX = Infinity, minY = Infinity;
        let maxX = -Infinity, maxY = -Infinity;

        // Find selection bounds
        for (const key of this.selection) {
            const [x, y] = key.split(',').map(Number);
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
        }

        if (minX === Infinity) return;

        // Capture all pixels within the defined selection area
        for (const key of this.selection) {
            const [x, y] = key.split(',').map(Number);
            const p = this.getPixel(x, y);
            if (p !== 0) {
                pixels.set(`${x - minX},${y - minY}`, p);
            }
        }

        this.clipboard = {
            pixels: pixels,
            width: maxX - minX + 1,
            height: maxY - minY + 1
        };
    }

    cutSelection() {
        if (!this.hasSelection || !this.selection) return;
        
        this.copySelection();
        
        const layerIdx = this.currentLayerIndex;
        const coordsToRemove = [];
        for (const key of this.selection) {
            const [x, y] = key.split(',').map(Number);
            if (this.getPixel(x, y, layerIdx) !== 0) {
                coordsToRemove.push({x, y});
            }
        }

        if (coordsToRemove.length > 0) {
            this.isDirty = true;
            this.saveState();
            const hasSelectionBefore = this.hasSelection;
            this.hasSelection = false;
            coordsToRemove.forEach(p => this.setPixel(p.x, p.y, 0, layerIdx));
            this.hasSelection = hasSelectionBefore;
            this.saveState();
            this.render();
        }
    }

    pasteSelection() {
        if (!this.clipboard) return;

        // Automatically paste to a new layer
        this.addLayer("Pasted Content");

        this.floatingBuffer = new Map(this.clipboard.pixels);
        this.floatingBufferX = Math.floor(this.gridSize / 4); 
        this.floatingBufferY = Math.floor(this.gridSize / 4);
        
        this.selection = new Set();
        for (const key of this.floatingBuffer.keys()) {
            const [lx, ly] = key.split(',').map(Number);
            this.selection.add(`${lx + this.floatingBufferX},${ly + this.floatingBufferY}`);
        }
        this.hasSelection = true;
        this.isDraggingSelection = false;
        this.tool = 'move';
        this.updateUI();
        this.render();
    }

    render() {
        this.ctxDraw.clearRect(0, 0, this.ctxDraw.canvas.width, this.ctxDraw.canvas.height);
        
        if (this.onionSkin) {
            // Render Previous Frames (Red Tint)
            for (let i = 1; i <= this.onionSkinPrev; i++) {
                const targetIdx = this.currentFrameIndex - i;
                if (targetIdx >= 0) {
                    const opacity = 0.3 - (i * 0.05); // Fade out further frames
                    if (opacity > 0) this.renderOnionSkinFrame(targetIdx, [255, 100, 100], Math.max(0.05, opacity));
                }
            }
            // Render Next Frames (Green/Blue Tint)
            for (let i = 1; i <= this.onionSkinNext; i++) {
                const targetIdx = this.currentFrameIndex + i;
                if (targetIdx < this.frames.length) {
                    const opacity = 0.3 - (i * 0.05);
                    if (opacity > 0) this.renderOnionSkinFrame(targetIdx, [100, 255, 150], Math.max(0.05, opacity));
                }
            }
        }

        this.renderFrameToContext(this.currentFrameIndex, this.ctxDraw, 1.0);
        
        // Render Floating Buffer (Selection Move)
        if (this.floatingBuffer) {
            this.ctxDraw.save();
            this.ctxDraw.globalAlpha = 0.6; // Ghosting effect
            
            for(const [key, p] of this.floatingBuffer) {
                const [sx, sy] = key.split(',').map(Number);
                const nx = sx + this.floatingBufferX;
                const ny = sy + this.floatingBufferY;
                
                // Only draw if visible on screen
                if (nx >= 0 && nx < this.gridWidth && ny >= 0 && ny < this.gridHeight) {
                     this.ctxDraw.fillStyle = this.intToHex(p);
                     this.ctxDraw.fillRect(nx * this.pixelScale, ny * this.pixelScale, this.pixelScale, this.pixelScale);
                }
            }
            this.ctxDraw.restore();
        }

        this.updatePreview();
        this.updateLiveFrameThumb();
        this.updateLayerThumbs();
        this.updateFavicon();
    }

    updateFavicon() {
        const canvas = this.generateFrameCanvas(this.currentFrameIndex);
        const favicon = document.getElementById('favicon');
        if (favicon) {
            favicon.href = canvas.toDataURL();
        }
    }
    
    intToHex(int) {
        const r = int & 0xFF;
        const g = (int >> 8) & 0xFF;
        const b = (int >> 16) & 0xFF;
        return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    renderOnionSkinFrame(frameIdx, tintColor, globalAlpha) {
        const frame = this.frames[frameIdx];
        if (!frame) return;
        const offscreen = document.createElement('canvas'); offscreen.width = this.gridWidth; offscreen.height = this.gridHeight;
        const offCtx = offscreen.getContext('2d'), imgData = offCtx.createImageData(this.gridWidth, this.gridHeight), data = imgData.data;
        
        // Render ONLY the active layer for onion skin (less clutter)
        const l = this.currentLayerIndex;
        const layer = this.layers[l]; 
        if (layer && layer.visible) {
            const pixels = frame[l];
            const ox = layer.x || 0; const oy = layer.y || 0;
            
            for (const [key, p] of pixels) {
                const [lx, ly] = key.split(',').map(Number);
                const cx = lx + ox, cy = ly + oy;
                if (cx >= 0 && cx < this.gridWidth && cy >= 0 && cy < this.gridHeight) {
                    const idx = (cy * this.gridWidth + cx) * 4;
                    data[idx] = tintColor[0];
                    data[idx+1] = tintColor[1];
                    data[idx+2] = tintColor[2];
                    data[idx+3] = 255 * globalAlpha;
                }
            }
        }

        offCtx.putImageData(imgData, 0, 0); 
        this.ctxDraw.save(); 
        this.ctxDraw.imageSmoothingEnabled = false;
        this.ctxDraw.drawImage(offscreen, 0, 0, this.gridWidth * this.pixelScale, this.gridHeight * this.pixelScale); 
        this.ctxDraw.restore();
    }

    renderFrameToContext(frameIdx, ctx, globalAlpha) {
        const frame = this.frames[frameIdx];
        if (!frame) return;
        const offscreen = document.createElement('canvas'); offscreen.width = this.gridWidth; offscreen.height = this.gridHeight;
        const offCtx = offscreen.getContext('2d'), imgData = offCtx.createImageData(this.gridWidth, this.gridHeight), data = imgData.data; 
        
        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layerMeta = this.layers[l]; if (!layerMeta.visible) continue;
            const layerPixels = frame[l], opacity = (layerMeta.opacity / 255) * globalAlpha, ox = layerMeta.x || 0, oy = layerMeta.y || 0;
            
            // Clipping Mask Logic
            let maskPixels = null;
            let maskOx = 0, maskOy = 0;
            
            if (layerMeta.clipped && l < this.layers.length - 1) {
                let baseIdx = l + 1;
                while (baseIdx < this.layers.length - 1 && this.layers[baseIdx].clipped) {
                    baseIdx++;
                }
                if (this.layers[baseIdx].visible) {
                    maskPixels = frame[baseIdx];
                    maskOx = this.layers[baseIdx].x || 0;
                    maskOy = this.layers[baseIdx].y || 0;
                } else {
                    continue;
                }
            } else if (layerMeta.clipped) {
                continue; 
            }

            for (const [key, p] of layerPixels) {
                const [lx, ly] = key.split(',').map(Number);
                const sx = lx + ox;
                const sy = ly + oy;

                // Check mask
                if (maskPixels) {
                    const mx = sx - maskOx;
                    const my = sy - maskOy;
                    if (!maskPixels.has(`${mx},${my}`)) continue;
                }

                if (sx >= 0 && sx < this.gridWidth && sy >= 0 && sy < this.gridHeight) {
                    const r = p & 0xFF, g = (p >> 8) & 0xFF, b = (p >> 16) & 0xFF, baseIdx = (sy * this.gridWidth + sx) * 4;
                    // Note: Simplified blending (overwrite) to match previous implementation
                    data[baseIdx] = r; data[baseIdx+1] = g; data[baseIdx+2] = b; data[baseIdx+3] = 255 * opacity;
                }
            }
        }
        offCtx.putImageData(imgData, 0, 0); ctx.save(); ctx.globalAlpha = 1.0; ctx.imageSmoothingEnabled = false;
        ctx.drawImage(offscreen, 0, 0, this.gridWidth * this.pixelScale, this.gridHeight * this.pixelScale); ctx.restore();
    }

    toggleLayerClip(idx) {
        if (idx >= this.layers.length - 1) return; // Cant clip bottom layer
        this.layers[idx].clipped = !this.layers[idx].clipped;
        this.isDirty = true;
        this.saveState();
        this.render();
        this.updateUI();
    }

    updatePreview() {
        const ctx = this.ctxPreview; ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        const offscreen = document.createElement('canvas'); offscreen.width = this.gridWidth; offscreen.height = this.gridHeight;
        const offCtx = offscreen.getContext('2d'), imgData = offCtx.createImageData(this.gridWidth, this.gridHeight), data = imgData.data, frame = this.frames[this.currentFrameIndex];
        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layer = this.layers[l]; if (!layer.visible) continue;
            const pixels = frame[l], ox = layer.x || 0, oy = layer.y || 0;
            for (const [key, p] of pixels) {
                const [lx, ly] = key.split(',').map(Number);
                const cx = lx + ox, cy = ly + oy;
                if (cx >= 0 && cx < this.gridWidth && cy >= 0 && cy < this.gridHeight) {
                    const idx = (cy * this.gridWidth + cx) * 4;
                    data[idx] = p & 0xFF; data[idx+1] = (p >> 8) & 0xFF; data[idx+2] = (p >> 16) & 0xFF; data[idx+3] = 255;
                }
            }
        }
        offCtx.putImageData(imgData, 0, 0); ctx.imageSmoothingEnabled = false; ctx.drawImage(offscreen, 0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    updateLayerThumbs() {
        const previews = document.querySelectorAll('.layer-preview');
        previews.forEach(cvs => {
            const idx = parseInt(cvs.dataset.index);
            if (idx === this.currentLayerIndex) {
                const ctx = cvs.getContext('2d');
                const imgData = ctx.createImageData(this.gridWidth, this.gridHeight);
                const data = imgData.data;
                const pixels = this.frames[this.currentFrameIndex][idx];
                
                for (const [key, p] of pixels) {
                    const [lx, ly] = key.split(',').map(Number);
                    if (lx >= 0 && lx < this.gridWidth && ly >= 0 && ly < this.gridHeight) {
                        const b = (ly * this.gridWidth + lx) * 4;
                        data[b] = p & 0xFF;
                        data[b+1] = (p >> 8) & 0xFF;
                        data[b+2] = (p >> 16) & 0xFF;
                        data[b+3] = 255;
                    }
                }
                ctx.putImageData(imgData, 0, 0);
            }
        });
    }

    updateLiveFrameThumb() {
        const container = document.getElementById('frames-list');
        const cvs = container.querySelector(`.frame-thumb.active canvas`);
        if (!cvs) return;

        const ctx = cvs.getContext('2d');
        const imgData = ctx.createImageData(this.gridWidth, this.gridHeight);
        const data = imgData.data;
        const frame = this.frames[this.currentFrameIndex];

        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layer = this.layers[l];
            if (!layer.visible) continue;
            const pixels = frame[l];
            const ox = layer.x || 0;
            const oy = layer.y || 0;
            for (const [key, p] of pixels) {
                const [lx, ly] = key.split(',').map(Number);
                const cx = lx + ox;
                const cy = ly + oy;
                if (cx >= 0 && cx < this.gridWidth && cy >= 0 && cy < this.gridHeight) {
                    const base = (cy * this.gridWidth + cx) * 4;
                    data[base] = p & 0xFF;
                    data[base+1] = (p >> 8) & 0xFF;
                    data[base+2] = (p >> 16) & 0xFF;
                    data[base+3] = 255;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0);
    }

    updateThumbs() {
        const container = document.getElementById('frames-list'); container.innerHTML = '';
        this.frames.forEach((_, idx) => {
            const div = document.createElement('div');
            div.className = `frame-thumb ${idx === this.currentFrameIndex ? 'active' : ''}`;
            div.draggable = true;
            div.dataset.index = idx;

            // Drag Events
            div.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', idx);
                e.dataTransfer.effectAllowed = 'move';
                div.classList.add('dragging');
            };
            div.ondragend = (e) => {
                div.classList.remove('dragging');
                document.querySelectorAll('.frame-thumb').forEach(el => el.classList.remove('drag-over'));
            };
            div.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                div.classList.add('drag-over');
            };
            div.ondragleave = (e) => {
                div.classList.remove('drag-over');
            };
            div.ondrop = (e) => {
                e.preventDefault();
                const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
                const toIdx = idx; 
                this.reorderFrames(fromIdx, toIdx);
            };

            div.onclick = () => { this.currentFrameIndex = idx; this.render(); this.updateUI(); };
            const num = document.createElement('div'); num.className = 'frame-num'; num.innerText = idx + 1;
            div.appendChild(num); const cvs = document.createElement('canvas'); 
            cvs.dataset.index = idx;
            cvs.width = this.gridWidth; cvs.height = this.gridHeight;
            const ctx = cvs.getContext('2d'), imgData = ctx.createImageData(this.gridWidth, this.gridHeight), data = imgData.data, frame = this.frames[idx];
            for (let l = this.layers.length - 1; l >= 0; l--) {
                const layer = this.layers[l]; if (!layer.visible) continue;
                const pixels = frame[l], ox = layer.x || 0, oy = layer.y || 0;
                for (const [key, p] of pixels) {
                    const [lx, ly] = key.split(',').map(Number);
                    const cx = lx + ox, cy = ly + oy;
                    if (cx >= 0 && cx < this.gridWidth && cy >= 0 && cy < this.gridHeight) {
                        const base = (cy * this.gridWidth + cx) * 4;
                        data[base] = p&0xFF; data[base+1]=(p>>8)&0xFF; data[base+2]=(p>>16)&0xFF; data[base+3]=255;
                    }
                }
            }
            ctx.putImageData(imgData, 0, 0); div.appendChild(cvs); container.appendChild(div);
        });
    }

    reorderFrames(fromIdx, toIdx) {
        if (fromIdx === toIdx) return;
        const frameToMove = this.frames[fromIdx];
        this.frames.splice(fromIdx, 1);
        this.frames.splice(toIdx, 0, frameToMove);
        
        // Update current frame index
        if (this.currentFrameIndex === fromIdx) {
            this.currentFrameIndex = toIdx;
        } else if (fromIdx < this.currentFrameIndex && toIdx >= this.currentFrameIndex) {
            this.currentFrameIndex--;
        } else if (fromIdx > this.currentFrameIndex && toIdx <= this.currentFrameIndex) {
            this.currentFrameIndex++;
        }

        this.isDirty = true;
        this.saveState();
        this.render();
        this.updateUI();
    }

    drawCursor(x, y, shift, alt) {
        const ctx = this.ctxCursor; ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        
        // Draw Selection Overlay
        if (this.hasSelection && this.selection) {
            ctx.fillStyle = 'rgba(50, 150, 255, 0.25)'; // Semi-transparent blue
            
            const offsetX = this.floatingBuffer ? this.floatingBufferX : 0;
            const offsetY = this.floatingBuffer ? this.floatingBufferY : 0;

            for (const key of this.selection) {
                const [sx, sy] = key.split(',').map(Number);
                const lx = sx + offsetX;
                const ly = sy + offsetY;
                
                if (lx >= -100 && lx < this.gridWidth + 100 && ly >= -100 && ly < this.gridHeight + 100) {
                    ctx.fillRect(lx * this.pixelScale, ly * this.pixelScale, this.pixelScale, this.pixelScale);
                }
            }
        }

        ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)'; ctx.lineWidth = 1;
        const halfX = (this.gridWidth * this.pixelScale) / 2;
        const halfY = (this.gridHeight * this.pixelScale) / 2;
        if (this.symmetry === 'vertical' || this.symmetry === 'radial') { ctx.beginPath(); ctx.moveTo(halfX, 0); ctx.lineTo(halfX, ctx.canvas.height); ctx.stroke(); }
        if (this.symmetry === 'horizontal' || this.symmetry === 'radial') { ctx.beginPath(); ctx.moveTo(0, halfY); ctx.lineTo(ctx.canvas.width, halfY); ctx.stroke(); }
        
        if (this.isDrawing && this.tool === 'select') {
            // Draw dashed selection box (Black and White for visibility on any BG)
            const x = Math.min(this.startX, this.currentX) * this.pixelScale;
            const y = Math.min(this.startY, this.currentY) * this.pixelScale;
            const w = (Math.abs(this.currentX - this.startX) + 1) * this.pixelScale;
            const h = (Math.abs(this.currentY - this.startY) + 1) * this.pixelScale;

            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#000';
            ctx.strokeRect(x, y, w, h);
            
            ctx.lineDashOffset = 5;
            ctx.strokeStyle = '#fff';
            ctx.strokeRect(x, y, w, h);
            
            ctx.lineDashOffset = 0;
            ctx.setLineDash([]);
            return;
        }

        if (this.isDrawing && this.tool === 'lasso' && this.lassoPath.length > 1) {
            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = '#000';
            ctx.beginPath();
            ctx.moveTo(this.lassoPath[0].x * this.pixelScale, this.lassoPath[0].y * this.pixelScale);
            for(let i=1; i<this.lassoPath.length; i++) {
                ctx.lineTo(this.lassoPath[i].x * this.pixelScale, this.lassoPath[i].y * this.pixelScale);
            }
            ctx.stroke();

            ctx.lineDashOffset = 5;
            ctx.strokeStyle = '#fff';
            ctx.stroke();
            
            ctx.lineDashOffset = 0;
            ctx.setLineDash([]);
            return;
        }

        if (this.isDrawing && (this.tool === 'rectangle' || this.tool === 'ellipse')) {
            const pixels = this.getShapePixels(this.startX, this.startY, this.currentX, this.currentY, this.tool, shift, alt);
            ctx.fillStyle = this.color;
            pixels.forEach(p => {
                const sym = this.getSymmetryPoints(p.x, p.y);
                sym.forEach(sp => { ctx.fillRect(sp.x * this.pixelScale, sp.y * this.pixelScale, this.pixelScale, this.pixelScale); });
            });
            return;
        }

        // Hide square ghost cursor for non-drawing tools
        if (['picker', 'bucket', 'move', 'select', 'lasso', 'wand'].includes(this.tool)) return;

        if (x >= 0 && x < this.gridSize && y >= 0 && y < this.gridSize) {
            const points = this.getSymmetryPoints(x, y);
            ctx.fillStyle = this.tool === 'eraser' ? 'rgba(255,255,255,0.5)' : this.color; ctx.strokeStyle = '#fff';
            const radius = Math.floor(this.brushSize / 2);
            points.forEach(p => {
                const px = (p.x - radius) * this.pixelScale;
                const py = (p.y - radius) * this.pixelScale;
                const s = this.brushSize * this.pixelScale;
                ctx.fillRect(px, py, s, s);
                ctx.strokeRect(px, py, s, s);
            });
        }
    }

    importImage(file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                const tempCvs = document.createElement('canvas'); tempCvs.width = this.gridWidth; tempCvs.height = this.gridHeight;
                const ctx = tempCvs.getContext('2d'); ctx.drawImage(img, 0, 0, this.gridWidth, this.gridHeight);
                const imgData = ctx.getImageData(0, 0, this.gridWidth, this.gridHeight), data = imgData.data, pixelData = new Map();
                for(let i=0; i< (data.length / 4); i++) {
                    const r = data[i*4], g = data[i*4+1], b = data[i*4+2], a = data[i*4+3];
                    if (a > 50) {
                        const lx = i % this.gridWidth;
                        const ly = Math.floor(i / this.gridWidth);
                        pixelData.set(`${lx},${ly}`, (255 << 24) | (b << 16) | (g << 8) | r);
                    }
                }
                this.addLayer("Imported Image", pixelData);
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    serialize() {
        return {
            version: '1.0.0',
            name: document.querySelector('.project-title').innerText,
            width: this.gridWidth,
            height: this.gridHeight,
            currentFrameIndex: this.currentFrameIndex,
            currentLayerIndex: this.currentLayerIndex,
            fps: this.fps,
            loopMode: this.loopMode,
            layers: this.layers, // Metadata is already JSON safe
            frames: this.frames.map(frame => 
                frame.map(layerMap => Array.from(layerMap.entries()))
            )
        };
    }

    deserialize(data) {
        try {
            this.gridWidth = data.width || data.gridSize || 32;
            this.gridHeight = data.height || data.gridSize || 32;
            this.gridSize = this.gridWidth; // For compatibility
            
            const titleEl = document.querySelector('.project-title');
            if (titleEl) titleEl.innerText = data.name || 'Untitled';
            
            this.fps = data.fps || 12;
            this.loopMode = data.loopMode || 'loop';
            this.currentFrameIndex = data.currentFrameIndex || 0;
            this.currentLayerIndex = data.currentLayerIndex || 0;
            this.layers = data.layers || [];
            
            this.frames = data.frames.map(frame => 
                frame.map(layerEntries => new Map(layerEntries))
            );

            this.history = [];
            this.historyIndex = -1;
            
            // Push initial snapshot to history without triggering saveToLocal
            const frameSnapshot = this.frames[this.currentFrameIndex].map(l => new Map(l));
            const layersSnapshot = this.layers.map(l => ({...l}));
            this.history.push({ frameIdx: this.currentFrameIndex, data: frameSnapshot, layers: layersSnapshot });
            this.historyIndex = 0;

            this.updateCanvasSize();
            this.render();
            this.updateUI();
        } catch (e) {
            console.error("Failed to parse project data", e);
            alert("Error loading project file.");
        }
    }

    // --- IndexedDB Auto-Save ---
    async saveToLocal() {
        const data = this.serialize();
        const request = indexedDB.open("PixelForgeDB", 1);
        
        request.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains("projects")) {
                db.createObjectStore("projects");
            }
        };

        request.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction("projects", "readwrite");
            const store = tx.objectStore("projects");
            const saveReq = store.put(data, "lastSession");
            saveReq.onerror = () => console.warn("Auto-save failed: Database write error.");
        };

        request.onerror = (e) => {
            console.warn("Auto-save unavailable: IndexedDB is blocked on local file systems in some browsers.");
        };
    }

    async loadFromLocal() {
        return new Promise((resolve) => {
            try {
                const request = indexedDB.open("PixelForgeDB", 1);
                
                request.onupgradeneeded = (e) => {
                    const db = e.target.result;
                    if (!db.objectStoreNames.contains("projects")) {
                        db.createObjectStore("projects");
                    }
                };

                request.onsuccess = (e) => {
                    const db = e.target.result;
                    const tx = db.transaction("projects", "readonly");
                    const store = tx.objectStore("projects");
                    const getReq = store.get("lastSession");
                    
                    getReq.onsuccess = () => resolve(getReq.result);
                    getReq.onerror = () => resolve(null);
                };

                request.onerror = () => {
                    console.log("IndexedDB access denied (standard for local file:// access).");
                    resolve(null);
                };
            } catch (err) {
                resolve(null);
            }
        });
    }

    // --- File System Save/Load ---
    saveToFile() {
        const data = JSON.stringify(this.serialize());
        const blob = new Blob([data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const name = this.getProjectName();
        
        link.href = url;
        link.download = `${name}.pforge`;
        link.click();
        URL.revokeObjectURL(url);
        this.showToast("Project saved", "success");
    }

    loadFromFile(file) {
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                this.deserialize(data);
            } catch (err) {
                alert("Invalid .pforge file.");
            }
        };
        reader.readAsText(file);
    }

    saveState() {
        if (!this.isDirty) return;
        this.isDirty = false;
        
        // Trigger Auto-save to IndexedDB
        this.saveToLocal();

        const frameSnapshot = this.frames[this.currentFrameIndex].map(l => new Map(l));
        const layersSnapshot = this.layers.map(l => ({...l}));
        if (this.historyIndex < this.history.length - 1) this.history = this.history.slice(0, this.historyIndex + 1);
        this.history.push({ frameIdx: this.currentFrameIndex, data: frameSnapshot, layers: layersSnapshot });
        if (this.history.length > 20) this.history.shift(); else this.historyIndex++;
    }

    undo() { 
        if (this.historyIndex > 0) { 
            this.historyIndex--; 
            this.restoreState(this.history[this.historyIndex]); 
            this.showToast("Undo");
        } 
    }
    redo() { 
        if (this.historyIndex < this.history.length - 1) { 
            this.historyIndex++; 
            this.restoreState(this.history[this.historyIndex]); 
            this.showToast("Redo");
        } 
    }
    zoomIn() { this.zoom = Math.min(5.0, this.zoom + 0.1); this.updateCanvasSize(); }
    zoomOut() { this.zoom = Math.max(0.1, this.zoom - 0.1); this.updateCanvasSize(); }
    restoreState(state) {
        this.currentFrameIndex = state.frameIdx; this.frames[this.currentFrameIndex] = state.data.map(l => new Map(l));
        this.layers = state.layers.map(l => ({...l})); this.render(); this.updateUI();
    }
    getProjectName() {
        const titleEl = document.querySelector('.project-title');
        let name = titleEl ? titleEl.innerText.trim() : 'pixel-art';
        return name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'pixel-art';
    }
    createNewProjectFromModal() {
        const nameInput = document.getElementById('new-project-name');
        const sizeSelect = document.getElementById('new-project-size');
        const customWInput = document.getElementById('new-project-width');
        const customHInput = document.getElementById('new-project-height');
        const bgColorInput = document.getElementById('new-project-bg-color');
        const bgTransparent = document.getElementById('new-project-bg-transparent');
        
        const name = nameInput ? nameInput.value : 'Untitled';
        const color = bgColorInput ? bgColorInput.value : '#ffffff';
        const transparent = bgTransparent ? bgTransparent.checked : false;

        let width, height;
        if (sizeSelect && sizeSelect.value === 'custom') {
            width = parseInt(customWInput.value) || 32;
            height = parseInt(customHInput.value) || 32;
            // Enforce max bounds
            width = Math.min(300, Math.max(1, width));
            height = Math.min(300, Math.max(1, height));
        } else {
            const size = sizeSelect ? parseInt(sizeSelect.value) : 32;
            width = height = size;
        }

        this.initializeNewProject(width, height, name, transparent ? null : color);
        
        document.getElementById('new-project-modal').classList.remove('open');
    }

    initializeNewProject(width, height, name, bgColor) {
        this.gridSize = width; // For square logic compatibility
        this.gridWidth = width;
        this.gridHeight = height;
        
        // Update Title
        const titleEl = document.querySelector('.project-title');
        if (titleEl) titleEl.innerText = name;
        
        // Reset State
        this.frames = [];
        this.layers = [
            { name: 'Layer 1', visible: true, opacity: 255, x: 0, y: 0 },
            { name: 'Layer 2', visible: true, opacity: 255, x: 0, y: 0 },
            { name: 'Layer 3', visible: true, opacity: 255, x: 0, y: 0 }
        ];
        this.currentFrameIndex = 0;
        this.currentLayerIndex = 0;
        this.history = [];
        this.historyIndex = -1;
        
        // Initialize First Frame
        const frame = [];
        for(let i=0; i<this.layers.length; i++) {
            frame.push(this.createEmptyLayerData());
        }
        
        // Apply Background if not transparent (Fill bottom layer)
        if (bgColor) {
            const bottomLayerIndex = this.layers.length - 1;
            const bgInt = this.hexToInt(bgColor);
            const layerData = frame[bottomLayerIndex];
            
            for(let y=0; y<this.gridHeight; y++) {
                for(let x=0; x<this.gridWidth; x++) {
                    layerData.set(`${x},${y}`, bgInt);
                }
            }
        }
        
        this.frames.push(frame);

        this.updateCanvasSize();
        this.isDirty = true;
        this.saveState();
        this.render();
        this.updateUI();
    }
    togglePlay() { 
        this.isPlaying = !this.isPlaying; 
        document.getElementById('play-btn').innerText = this.isPlaying ? '⏸ Pause' : '▶ Play'; 
        if (this.isPlaying) {
            // If at the end of 'once' mode, restart from beginning
            if (this.loopMode === 'once' && this.currentFrameIndex === this.frames.length - 1) {
                this.currentFrameIndex = 0;
            }
            this.animate(); 
        }
    }

    animate() { 
        if (!this.isPlaying) return; 

        setTimeout(() => { 
            requestAnimationFrame(() => this.animate()); 
        }, 1000 / this.fps); 

        if (this.loopMode === 'loop') {
            this.currentFrameIndex = (this.currentFrameIndex + 1) % this.frames.length;
        } 
        else if (this.loopMode === 'pingpong') {
            this.currentFrameIndex += this.playDirection;
            if (this.currentFrameIndex >= this.frames.length - 1) {
                this.currentFrameIndex = this.frames.length - 1;
                this.playDirection = -1;
            } else if (this.currentFrameIndex <= 0) {
                this.currentFrameIndex = 0;
                this.playDirection = 1;
            }
        } 
        else if (this.loopMode === 'once') {
            if (this.currentFrameIndex < this.frames.length - 1) {
                this.currentFrameIndex++;
            } else {
                this.togglePlay();
            }
        }

        this.render(); 
        this.updateUI(); 
    }

    showShortcuts() {
        document.getElementById('shortcuts-modal').classList.add('open');
    }

    showAbout() {
        document.getElementById('about-modal').classList.add('open');
    }

    generateFrameCanvas(frameIdx) {
        const cvs = document.createElement('canvas'); 
        cvs.width = this.gridWidth; 
        cvs.height = this.gridHeight;
        const ctx = cvs.getContext('2d');
        const imgData = ctx.createImageData(this.gridWidth, this.gridHeight);
        const data = imgData.data;
        const frame = this.frames[frameIdx];

        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layer = this.layers[l]; if (!layer.visible) continue;
            const pixels = frame[l], ox = layer.x || 0, oy = layer.y || 0, opacity = layer.opacity / 255;
            for (const [key, p] of pixels) {
                const [lx, ly] = key.split(',').map(Number);
                const cx = lx + ox, cy = ly + oy;
                if (cx >= 0 && cx < this.gridWidth && cy >= 0 && cy < this.gridHeight) {
                    const idx = (cy * this.gridWidth + cx) * 4;
                    // Blend colors (Simplified)
                    data[idx] = p & 0xFF;
                    data[idx+1] = (p >> 8) & 0xFF;
                    data[idx+2] = (p >> 16) & 0xFF;
                    data[idx+3] = 255 * opacity;
                }
            }
        }
        ctx.putImageData(imgData, 0, 0); 
        return cvs;
    }

    exportPNG(scale = 1) { 
        const rawCanvas = this.generateFrameCanvas(this.currentFrameIndex);
        const name = this.getProjectName();
        if (scale === 1) {
            const link = document.createElement('a'); link.download = `${name}.png`; link.href = rawCanvas.toDataURL(); link.click();
        } else {
            const cvs = document.createElement('canvas'); cvs.width = this.gridWidth * scale; cvs.height = this.gridHeight * scale;
            const ctx = cvs.getContext('2d'); ctx.imageSmoothingEnabled = false;
            ctx.drawImage(rawCanvas, 0, 0, cvs.width, cvs.height);
            const link = document.createElement('a'); link.download = `${name}-x${scale}.png`; link.href = cvs.toDataURL(); link.click();
        }
    }

    exportSVG() {
        const scale = 50;
        const width = this.gridWidth * scale;
        const height = this.gridHeight * scale;
        const name = this.getProjectName();
        let svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges">`;
        const frame = this.frames[this.currentFrameIndex];
        
        for (let l = this.layers.length - 1; l >= 0; l--) {
            const layer = this.layers[l];
            if (!layer.visible) continue;
            const pixels = frame[l];
            const ox = layer.x || 0;
            const oy = layer.y || 0;
            const opacity = layer.opacity / 255;
            
            for (const [key, p] of pixels) {
                const [lx, ly] = key.split(',').map(Number);
                const cx = (lx + ox) * scale;
                const cy = (ly + oy) * scale;
                
                if (cx >= 0 && cx < width && cy >= 0 && cy < height) {
                    const r = p & 0xFF;
                    const g = (p >> 8) & 0xFF;
                    const b = (p >> 16) & 0xFF;
                    svg += `<rect x="${cx}" y="${cy}" width="${scale}" height="${scale}" fill="rgb(${r},${g},${b})" fill-opacity="${opacity}" />`;
                }
            }
        }
        svg += '</svg>';
        const blob = new Blob([svg], {type: 'image/svg+xml'});
        const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = `${name}.svg`; link.click();
    }
    exportSpriteSheet() {
        if (this.frames.length === 0) return;
        const name = this.getProjectName();
        const count = this.frames.length, cols = Math.ceil(Math.sqrt(count)), rows = Math.ceil(count / cols);
        const sheet = document.createElement('canvas'); sheet.width = cols * this.gridWidth; sheet.height = rows * this.gridHeight;
        const ctx = sheet.getContext('2d');
        this.frames.forEach((_, idx) => {
            const frameCvs = this.generateFrameCanvas(idx), col = idx % cols, row = Math.floor(idx / cols);
            ctx.drawImage(frameCvs, col * this.gridWidth, row * this.gridHeight);
        });
        const link = document.createElement('a'); link.download = `${name}-sheet.png`; link.href = sheet.toDataURL(); link.click();
    }
    exportGIF() {
        const name = this.getProjectName();
        const encoder = new GIFEncoder(this.gridWidth, this.gridHeight), delay = 100 / this.fps * 10; 
        this.frames.forEach((_, idx) => {
            const cvs = this.generateFrameCanvas(idx), ctx = cvs.getContext('2d'), imgData = ctx.getImageData(0, 0, this.gridWidth, this.gridHeight);
            encoder.addFrame(imgData, delay); 
        });
        const binary = encoder.generate(), blob = new Blob([binary], { type: 'image/gif' }), link = document.createElement('a');
        link.href = URL.createObjectURL(blob); link.download = `${name}.gif`; link.click();
    }

    reorderLayers(fromIdx, toIdx) {
        if (fromIdx === toIdx) return;
        
        // Adjust logic because removing an element changes indices
        // If we move 0 to 2: remove 0 (array shrinks), insert at 2.
        // If we move 2 to 0: remove 2, insert at 0.
        
        const layerToMove = this.layers[fromIdx];
        this.layers.splice(fromIdx, 1);
        this.layers.splice(toIdx, 0, layerToMove);

        this.frames.forEach(frame => {
            const dataToMove = frame[fromIdx];
            frame.splice(fromIdx, 1);
            frame.splice(toIdx, 0, dataToMove);
        });

        // Update current layer index
        if (this.currentLayerIndex === fromIdx) {
            this.currentLayerIndex = toIdx;
        } else if (fromIdx < this.currentLayerIndex && toIdx >= this.currentLayerIndex) {
            this.currentLayerIndex--;
        } else if (fromIdx > this.currentLayerIndex && toIdx <= this.currentLayerIndex) {
            this.currentLayerIndex++;
        }

        this.isDirty = true;
        this.saveState();
        this.render();
        this.updateUI();
    }

    updateUI() {
        const layerList = document.getElementById('layers-list'); layerList.innerHTML = '';
        this.layers.forEach((l, idx) => {
            const item = document.createElement('div'); 
            item.className = `layer-item ${idx === this.currentLayerIndex ? 'active' : ''} ${l.clipped ? 'clipped' : ''}`;
            item.draggable = true;
            item.dataset.index = idx;

            // Drag Events
            item.ondragstart = (e) => {
                e.dataTransfer.setData('text/plain', idx);
                e.dataTransfer.effectAllowed = 'move';
                item.classList.add('dragging');
            };
            item.ondragend = (e) => {
                item.classList.remove('dragging');
                document.querySelectorAll('.layer-item').forEach(el => el.classList.remove('drag-over'));
            };
            item.ondragover = (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                item.classList.add('drag-over');
            };
            item.ondragleave = (e) => {
                item.classList.remove('drag-over');
            };
            item.ondrop = (e) => {
                e.preventDefault();
                const fromIdx = parseInt(e.dataTransfer.getData('text/plain'));
                const toIdx = idx; // Target index
                this.reorderLayers(fromIdx, toIdx);
            };

            item.onclick = (e) => { 
                if (e.ctrlKey || e.metaKey) {
                    this.selectLayerAlpha(idx);
                } else if (this.currentLayerIndex !== idx) { 
                    this.currentLayerIndex = idx; 
                    this.render(); // Ensure onion skin updates to new active layer
                    this.updateUI(); 
                    this.syncToolSettingsUI();
                } 
            };
            
            const cvs = document.createElement('canvas'); 
            cvs.className = 'layer-preview'; 
            cvs.width = this.gridWidth; 
            cvs.height = this.gridHeight;
            cvs.dataset.index = idx;
            
            const ctx = cvs.getContext('2d'), imgData = ctx.createImageData(this.gridWidth, this.gridHeight), data = imgData.data, pixels = this.frames[this.currentFrameIndex][idx];
            for (const [key, p] of pixels) {
                const [lx, ly] = key.split(',').map(Number);
                if (lx >= 0 && lx < this.gridWidth && ly >= 0 && ly < this.gridHeight) {
                    const b = (ly * this.gridWidth + lx) * 4;
                    data[b] = p&0xFF; data[b+1]=(p>>8)&0xFF; data[b+2]=(p>>16)&0xFF; data[b+3]=255;
                }
            }
            ctx.putImageData(imgData, 0, 0); const info = document.createElement('div'); info.className = 'layer-info';
            const nameDiv = document.createElement('div'); nameDiv.className = 'layer-name'; nameDiv.innerText = l.name; nameDiv.title = "Double-click to rename";
            nameDiv.ondblclick = (e) => { e.stopPropagation(); this.renameLayer(idx); };
            const controls = document.createElement('div'); controls.className = 'layer-controls';
            
            const visBtn = document.createElement('button'); visBtn.className = 'small-btn'; visBtn.innerText = l.visible ? '👁️' : '🚫'; visBtn.title = "Toggle Visibility"; visBtn.onclick = (e) => { e.stopPropagation(); this.toggleLayerVis(idx); };
            
            const clipBtn = document.createElement('button'); clipBtn.className = `small-btn ${l.clipped ? 'active' : ''}`; clipBtn.innerText = '⤵️'; clipBtn.title = "Toggle Clipping Mask"; 
            if (idx === this.layers.length - 1) { clipBtn.disabled = true; clipBtn.style.opacity = 0.3; }
            else { clipBtn.onclick = (e) => { e.stopPropagation(); this.toggleLayerClip(idx); }; }

            const delBtn = document.createElement('button'); delBtn.className = 'small-btn'; delBtn.style.color = 'var(--danger)'; delBtn.innerText = '×'; delBtn.title = "Delete Layer"; delBtn.onclick = (e) => { e.stopPropagation(); this.deleteLayer(idx); };
            
            controls.appendChild(visBtn); controls.appendChild(clipBtn); controls.appendChild(delBtn);
            info.appendChild(nameDiv); info.appendChild(controls); item.appendChild(cvs); item.appendChild(info); layerList.appendChild(item);
        });
        document.getElementById('layer-opacity').value = this.layers[this.currentLayerIndex].opacity;
        document.getElementById('fps-display').innerText = this.fps;
        
        // Sync Onion Skin UI
        const onionBtn = document.getElementById('onion-skin-btn');
        const onionSettings = document.getElementById('onion-skin-settings');
        if (onionBtn && onionSettings) {
            onionBtn.classList.toggle('active', this.onionSkin);
            onionSettings.style.display = this.onionSkin ? 'flex' : 'none';
        }
        
        // Update Cursor
        this.updateCursorClass();
        this.updateThumbs();
    }

    updateCursorClass() {
        const wrapper = document.getElementById('canvas-wrapper');
        wrapper.className = ''; // Clear classes
        
        // Contextual cursor: if hovering over selection with a selection tool, show move cursor
        const isHoveringSelection = this.isPosInSelection(this.currentX, this.currentY);
        
        if (this.tool === 'pencil') wrapper.classList.add('cursor-pencil');
        else if (this.tool === 'eraser') wrapper.classList.add('cursor-eraser');
        else if (this.tool === 'picker') wrapper.classList.add('cursor-picker');
        else if (this.tool === 'bucket') wrapper.classList.add('cursor-bucket');
        else if (this.tool === 'move' || (isHoveringSelection && ['select', 'lasso'].includes(this.tool))) wrapper.classList.add('cursor-move');
        else if (this.tool === 'select' || this.tool === 'lasso' || this.tool === 'wand') wrapper.classList.add('cursor-select');
        else if (['rectangle', 'ellipse', 'dither'].includes(this.tool)) wrapper.classList.add('cursor-crosshair');
        else wrapper.classList.add('cursor-pencil'); // Default
    }

    updateToolSettingsUI() {
        const panel = document.getElementById('tool-settings-panel');
        const ditherSettings = document.getElementById('dither-settings');
        const brushSettings = document.getElementById('brush-size-settings');
        
        if (!panel) return;

        panel.style.display = 'none';
        ditherSettings.style.display = 'none';
        brushSettings.style.display = 'none';

        if (this.tool === 'dither') {
            panel.style.display = 'block';
            ditherSettings.style.display = 'block';
            document.getElementById('settings-title').innerText = 'Dither Settings';
        } else if (['pencil', 'eraser', 'rectangle', 'ellipse'].includes(this.tool)) {
            panel.style.display = 'block';
            brushSettings.style.display = 'block';
            document.getElementById('settings-title').innerText = 'Brush Settings';
        }
    }

    shouldDrawDither(x, y) {
        switch (this.ditherPattern) {
            case '50': return (x + y) % 2 === 0;
            case '25': return x % 2 === 0 && y % 2 === 0;
            case '75': return ! (x % 2 !== 0 && y % 2 !== 0);
            case 'v-line': return x % 2 === 0;
            case 'h-line': return y % 2 === 0;
            case 'diagonal': return (x + y) % 4 === 0;
            default: return true;
        }
    }

    toggleLayerVis(idx) { this.layers[idx].visible = !this.layers[idx].visible; this.isDirty = true; this.saveState(); this.render(); this.updateUI(); }
    moveLayer(idx, dir) {
        // Deprecated but kept for compatibility if called elsewhere, though UI buttons are gone
        if (idx + dir < 0 || idx + dir >= this.layers.length) return;
        this.reorderLayers(idx, idx + dir);
    }

    setupEventListeners() {
        const c = this.cursorCanvas;
        const start = (e) => { this.handleDrawStart(e); };
        const move = (e) => { this.handleDrawMove(e); };
        const end = (e) => { this.handleDrawEnd(e); };

        // Canvas Events
        c.addEventListener('mousedown', start);
        window.addEventListener('mousemove', move);
        window.addEventListener('mouseup', end);
        c.addEventListener('touchstart', (e) => { e.preventDefault(); start(e); }, { passive: false });
        c.addEventListener('touchmove', (e) => { e.preventDefault(); move(e); }, { passive: false });
        c.addEventListener('touchend', end);

        // Menu Management
        let activeMenu = null;

        const closeAllMenus = () => {
            document.querySelectorAll('.menu-item').forEach(m => m.classList.remove('active'));
            activeMenu = null;
        };

        document.querySelectorAll('.menu-item').forEach(menu => {
            menu.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                const wasActive = menu.classList.contains('active');
                closeAllMenus();
                if (!wasActive) {
                    menu.classList.add('active');
                    activeMenu = menu;
                }
            });

            menu.addEventListener('mouseenter', () => {
                if (activeMenu && activeMenu !== menu) {
                    closeAllMenus();
                    menu.classList.add('active');
                    activeMenu = menu;
                }
            });
        });

        // Prevent closing when clicking inside dropdowns (like selects)
        document.querySelectorAll('.dropdown-menu').forEach(dm => {
            dm.addEventListener('mousedown', (e) => e.stopPropagation());
        });

        // Close menu when a functional item is clicked
        document.querySelectorAll('.dropdown-item').forEach(item => {
            item.addEventListener('click', (e) => {
                // Don't close if it's a submenu trigger or clicking a select
                if (item.classList.contains('submenu-trigger') || e.target.tagName === 'SELECT') {
                    return;
                }
                closeAllMenus();
            });
        });

        window.addEventListener('mousedown', () => closeAllMenus());

        // Click outside to deselect
        const workspace = document.getElementById('workspace');
        if (workspace) {
            workspace.addEventListener('mousedown', (e) => {
                if (e.target.id === 'workspace') {
                    this.clearSelection();
                }
            });
        }

        // Zoom with Mouse Wheel
        c.addEventListener('wheel', (e) => {
            if (e.ctrlKey) {
                e.preventDefault();
                if (e.deltaY < 0) this.zoomIn();
                else this.zoomOut();
            }
        }, { passive: false });

        // Header Zoom Display Interactions
        const zoomDisplay = document.getElementById('zoom-display-header');
        if (zoomDisplay) {
            zoomDisplay.style.cursor = 'ns-resize'; // Visual cue for scrolling
            
            // Scroll on % to zoom
            zoomDisplay.addEventListener('wheel', (e) => {
                e.preventDefault();
                if (e.deltaY < 0) this.zoomIn();
                else this.zoomOut();
            }, { passive: false });

            // Click to edit % manually
            zoomDisplay.addEventListener('click', () => {
                const currentZoom = Math.round(this.zoom * 100);
                const input = document.createElement('input');
                input.type = 'number';
                input.value = currentZoom;
                input.className = 'no-spin';
                input.style.width = '100%'; // Fill the 50px container
                input.style.height = '100%';
                input.style.background = '#111';
                input.style.color = 'white';
                input.style.border = '1px solid var(--primary)';
                input.style.fontSize = '0.8rem';
                input.style.textAlign = 'center';
                input.style.padding = '0';
                input.style.margin = '0';
                input.style.borderRadius = '3px';
                
                const commit = () => {
                    let val = parseInt(input.value);
                    if (!isNaN(val)) {
                        this.zoom = Math.max(0.1, Math.min(5.0, val / 100));
                        this.updateCanvasSize();
                    } else {
                        this.updateCanvasSize();
                    }
                };

                input.onkeydown = (e) => {
                    if (e.key === 'Enter') commit();
                    if (e.key === 'Escape') this.updateCanvasSize();
                    e.stopPropagation();
                };
                input.onblur = commit;

                zoomDisplay.innerHTML = '';
                zoomDisplay.appendChild(input);
                input.focus();
                input.select();
            });
        }



        // Tool Selection
        document.querySelectorAll('[data-tool]').forEach(btn => {
            btn.onclick = () => this.selectTool(btn.dataset.tool);
        });

        // Global Keyboard Shortcuts
        window.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

            const key = e.key.toLowerCase();
            const ctrl = e.ctrlKey || e.metaKey;

            // Tools
            if (key === 'p') this.selectTool('pencil');
            else if (key === 'e') this.selectTool('eraser');
            else if (key === 's') this.selectTool('select');
            else if (key === 'l') this.selectTool('lasso');
            else if (key === 'b') this.selectTool('bucket');
            else if (key === 'w') this.selectTool('wand');
            else if (key === 'i') this.selectTool('picker');
            else if (key === 'm') this.selectTool('move');
            else if (key === 'r') this.selectTool('rectangle');
            else if (key === 'c' && !ctrl) this.selectTool('ellipse');
            else if (key === 'd' && !ctrl) this.selectTool('dither');
            else if (key === 'x' && !ctrl) this.swapColors();

            // Actions
            if (ctrl && key === 's') { e.preventDefault(); this.saveToFile(); }
            else if (ctrl && key === 'z') { e.preventDefault(); this.undo(); }
            else if (ctrl && key === 'y') { e.preventDefault(); this.redo(); }
            else if (ctrl && key === 'x') { e.preventDefault(); this.cutSelection(); }
            else if (ctrl && key === 'c') { e.preventDefault(); this.copySelection(); }
            else if (ctrl && key === 'v') { e.preventDefault(); this.pasteSelection(); }
            else if (ctrl && key === 'd') { e.preventDefault(); this.clearSelection(); }
            else if (ctrl && key === '0') { e.preventDefault(); this.zoom = 1.0; this.updateCanvasSize(); }
            else if (key === '+' || key === '=') { this.zoomIn(); }
            else if (key === '-') { this.zoomOut(); }
            else if (key === ',') { 
                this.currentFrameIndex = (this.currentFrameIndex - 1 + this.frames.length) % this.frames.length;
                this.render();
                this.updateUI();
            }
            else if (key === '.') {
                this.currentFrameIndex = (this.currentFrameIndex + 1) % this.frames.length;
                this.render();
                this.updateUI();
            }
            else if (key === ' ') {
                e.preventDefault();
                this.togglePlay();
            }
        });

        // UI Controls
        const toggleGridBtn = document.getElementById('toggle-grid-btn');
        if (toggleGridBtn) {
            toggleGridBtn.onclick = (e) => {
                this.showGrid = !this.showGrid;
                e.target.classList.toggle('active');
                this.drawGrid();
            };
        }

        const customColorPicker = document.getElementById('custom-color-picker');
        if (customColorPicker) customColorPicker.oninput = (e) => this.setColor(e.target.value);

        const secondaryColorPicker = document.getElementById('secondary-color-picker');
        if (secondaryColorPicker) secondaryColorPicker.oninput = (e) => { this.setSecondaryColor(e.target.value); };

        // Dither Patterns
        document.querySelectorAll('.dither-p-btn').forEach(btn => {
            btn.onclick = () => {
                this.ditherPattern = btn.dataset.pattern;
                document.querySelectorAll('.dither-p-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
        });

        const brushSizeSlider = document.getElementById('brush-size-slider');
        const brushSizeDisplay = document.getElementById('brush-size-display');
        const genBrushSizeSlider = document.getElementById('gen-brush-size-slider');
        const genBrushSizeDisplay = document.getElementById('gen-brush-size-display');

        if (brushSizeSlider) {
            brushSizeSlider.oninput = (e) => {
                this.brushSize = parseInt(e.target.value);
                brushSizeDisplay.innerText = this.brushSize;
                if (genBrushSizeSlider) genBrushSizeSlider.value = this.brushSize;
                if (genBrushSizeDisplay) genBrushSizeDisplay.innerText = this.brushSize;
                this.updateActiveToolSettings();
            };
        }

        if (genBrushSizeSlider) {
            genBrushSizeSlider.oninput = (e) => {
                this.brushSize = parseInt(e.target.value);
                genBrushSizeDisplay.innerText = this.brushSize;
                if (brushSizeSlider) brushSizeSlider.value = this.brushSize;
                if (brushSizeDisplay) brushSizeDisplay.innerText = this.brushSize;
                this.updateActiveToolSettings();
            };
        }

        const ditherBlendToggle = document.getElementById('dither-blend-toggle');
        if (ditherBlendToggle) ditherBlendToggle.onchange = (e) => { this.ditherUseSecondary = e.target.checked; };

        const symmetrySelect = document.getElementById('symmetry-select');
        const symmetrySelectMenu = document.getElementById('symmetry-select-menu');
        
        const updateSymmetry = (val) => {
            this.symmetry = val;
            if (symmetrySelect) symmetrySelect.value = val;
            if (symmetrySelectMenu) symmetrySelectMenu.value = val;
            this.drawCursor(-1, -1);
        };

        if (symmetrySelect) symmetrySelect.onchange = (e) => updateSymmetry(e.target.value);
        if (symmetrySelectMenu) symmetrySelectMenu.onchange = (e) => updateSymmetry(e.target.value);

        const onionSkinBtn = document.getElementById('onion-skin-btn');
        if (onionSkinBtn) {
            onionSkinBtn.onclick = () => {
                this.onionSkin = !this.onionSkin;
                onionSkinBtn.classList.toggle('active', this.onionSkin);
                const onionSettings = document.getElementById('onion-skin-settings');
                if (onionSettings) onionSettings.style.display = this.onionSkin ? 'flex' : 'none';
                this.render();
            };
        }

        const onionPrevInput = document.getElementById('onion-prev-input');
        if (onionPrevInput) onionPrevInput.oninput = (e) => { this.onionSkinPrev = parseInt(e.target.value); this.render(); };

        const onionNextInput = document.getElementById('onion-next-input');
        if (onionNextInput) onionNextInput.oninput = (e) => { this.onionSkinNext = parseInt(e.target.value); this.render(); };

        const fpsSlider = document.getElementById('fps-slider');
        if (fpsSlider) {
            fpsSlider.oninput = (e) => {
                this.fps = parseInt(e.target.value);
                const fpsDisplay = document.getElementById('fps-display');
                if (fpsDisplay) fpsDisplay.innerText = this.fps;
            };
        }

        const newProjectSizeSelect = document.getElementById('new-project-size');
        if (newProjectSizeSelect) {
            newProjectSizeSelect.onchange = (e) => {
                const customArea = document.getElementById('custom-dimensions-area');
                if (customArea) {
                    customArea.style.display = e.target.value === 'custom' ? 'flex' : 'none';
                }
            };
        }

        const loopModeSelect = document.getElementById('loop-mode-select');
        if (loopModeSelect) {
            loopModeSelect.onchange = (e) => {
                this.loopMode = e.target.value;
                if (this.loopMode === 'pingpong') this.playDirection = 1;
            };
        }

        const refUpload = document.getElementById('ref-upload');
        if (refUpload) refUpload.onchange = (e) => this.importImage(e.target.files[0]);

        const projectUpload = document.getElementById('project-upload');
        if (projectUpload) projectUpload.onchange = (e) => this.loadFromFile(e.target.files[0]);

        const layerOpacity = document.getElementById('layer-opacity');
        if (layerOpacity) {
            layerOpacity.oninput = (e) => { this.layers[this.currentLayerIndex].opacity = parseInt(e.target.value); this.render(); };
            layerOpacity.onchange = (e) => { this.isDirty = true; this.saveState(); };
        }

        const fillShapesToggle = document.getElementById('fill-shapes-toggle');
        if (fillShapesToggle) fillShapesToggle.onchange = (e) => { this.fillShapes = e.target.checked; };

        const pixelPerfectToggle = document.getElementById('pixel-perfect-toggle');
        if (pixelPerfectToggle) {
            pixelPerfectToggle.onchange = (e) => { 
                this.pixelPerfect = e.target.checked; 
                this.updateActiveToolSettings();
            };
        }

        const smoothingSlider = document.getElementById('smoothing-slider');
        const smoothingDisplay = document.getElementById('smoothing-display');
        if (smoothingSlider) {
            smoothingSlider.oninput = (e) => {
                this.smoothing = parseInt(e.target.value);
                if (smoothingDisplay) smoothingDisplay.innerText = this.smoothing;
                this.updateActiveToolSettings();
            };
        }
    }

    updateActiveToolSettings() {
        if (this.tool === 'pencil') {
            this.pencilSettings = { size: this.brushSize, pixelPerfect: this.pixelPerfect, smoothing: this.smoothing };
        } else if (this.tool === 'eraser') {
            this.eraserSettings = { size: this.brushSize, pixelPerfect: this.pixelPerfect, smoothing: this.smoothing };
        }
    }
}
