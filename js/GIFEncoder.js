/**
 * Simple GIF Encoder (GIF89a)
 * A minimal implementation to support the requirements without external libraries.
 */
class GIFEncoder {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.frames = [];
        this.delay = 100; // default 10cs (100ms)
    }

    addFrame(imageData, delay) {
        this.frames.push({ data: imageData, delay: delay || this.delay });
    }

    // Helper to write a little-endian 16-bit int
    writeWord(arr, val) {
        arr.push(val & 0xFF);
        arr.push((val >> 8) & 0xFF);
    }

    // Helper to write a text string
    writeString(arr, str) {
        for (let i = 0; i < str.length; i++) arr.push(str.charCodeAt(i));
    }

    generate() {
        let output = [];
        
        // Header
        this.writeString(output, "GIF89a");
        this.writeWord(output, this.width);
        this.writeWord(output, this.height);
        
        // Logical Screen Descriptor (GCT Flag set, 256 colors)
        // 0xF7 = 1 111 0 111 (GCT present, 8 bits/pixel res, not sorted, 2^8 GCT size)
        output.push(0xF7); 
        output.push(0); // Bg color index
        output.push(0); // Aspect ratio

        // Global Color Table (Generates a basic 6x6x6 web safe palette + grays to ensure coverage)
        // For a true pixel art encoder, we would extract the palette from the frames.
        // For simplicity/speed in this single-file demo, we use a fixed 256 quantization or simply web-safe.
        // Let's generate a simple palette: R3G3B2 (less quality) or try to map colors dynamically.
        // Dynamic mapping is complex. We'll use a standard 256 color palette.
        const palette = [];
        const colorMap = new Map();
        
        // Add transparent
        palette.push([0,0,0]); 
        colorMap.set('0,0,0,0', 0);

        // Populate palette from frames
        // This is a naive quantizer. If > 255 colors, it will clip.
        for(let f=0; f<this.frames.length; f++) {
            const data = this.frames[f].data.data;
            for(let i=0; i<data.length; i+=4) {
                const r=data[i], g=data[i+1], b=data[i+2], a=data[i+3];
                if(a === 0) continue;
                const key = `${r},${g},${b}`;
                if(!colorMap.has(key)) {
                    if(palette.length < 256) {
                        colorMap.set(key, palette.length);
                        palette.push([r,g,b]);
                    }
                }
            }
        }

        // Fill rest with black if < 256
        while(palette.length < 256) palette.push([0,0,0]);

        // Write GCT
        for(let c of palette) {
            output.push(c[0]); output.push(c[1]); output.push(c[2]);
        }

        // Application Extension (Looping)
        output.push(0x21); // Extension Introducer
        output.push(0xFF); // App Extension Label
        output.push(11);   // Block Size
        this.writeString(output, "NETSCAPE2.0");
        output.push(3);    // Sub-block length
        output.push(1);    // Loop sub-block ID
        this.writeWord(output, 0); // Loop count (0 = infinite)
        output.push(0);    // Terminator

        // Frames
        for(let f=0; f<this.frames.length; f++) {
            const frame = this.frames[f];
            const data = frame.data.data;

            // Graphics Control Extension
            output.push(0x21); 
            output.push(0xF9);
            output.push(4); // Byte size
            // Packed: Reserved(3) | Disposal(3) | UserInput(1) | TranspFlag(1)
            // Disposal 2 = Restore to background (good for transparency)
            output.push(0x09); // 000 010 0 1 (Disposal 2, Transparency set)
            this.writeWord(output, Math.round(frame.delay / 10)); // Delay in 100ths
            output.push(0); // Transparent color index (0 in our map)
            output.push(0); // Terminator

            // Image Descriptor
            output.push(0x2C);
            this.writeWord(output, 0); // Left
            this.writeWord(output, 0); // Top
            this.writeWord(output, this.width);
            this.writeWord(output, this.height);
            output.push(0); // Local Color Table flag (0 = use Global)

            // Image Data (LZW Compression would go here)
            // Implementing LZW is complex. We will use uncompressed data blocks if possible 
            // but GIF requires LZW. We must implement a minimal LZW encoder.
            
            const indexedPixels = [];
            for(let i=0; i<data.length; i+=4) {
                if(data[i+3] === 0) {
                    indexedPixels.push(0);
                } else {
                    const key = `${data[i]},${data[i+1]},${data[i+2]}`;
                    indexedPixels.push(colorMap.get(key) || 0);
                }
            }

            this.lzwEncode(output, indexedPixels, 8); // 8-bit min code size
            output.push(0); // Block terminator
        }

        output.push(0x3B); // Trailer
        return new Uint8Array(output);
    }

    lzwEncode(output, pixels, minCodeSize) {
        output.push(minCodeSize); 
        
        const clearCode = 1 << minCodeSize;
        const eoiCode = clearCode + 1;
        let nextCode = eoiCode + 1;
        let curCodeSize = minCodeSize + 1;
        let dict = new Map();
        
        // Init dict
        for (let i = 0; i < clearCode; i++) dict.set(String(i), i);

        let pixelBuffer = [];
        
        // Add clear code
        this.writeBits(output, clearCode, curCodeSize, true); // true = reset

        let prefix = "";
        
        for (let i = 0; i < pixels.length; i++) {
            let pixel = pixels[i];
            let current = prefix === "" ? String(pixel) : prefix + "," + pixel;
            
            if (dict.has(current)) {
                prefix = current;
            } else {
                this.writeBits(output, dict.get(prefix), curCodeSize, false);
                
                if (nextCode < 4096) {
                    dict.set(current, nextCode++);
                } else {
                    this.writeBits(output, clearCode, curCodeSize, false);
                    dict = new Map();
                    for (let j = 0; j < clearCode; j++) dict.set(String(j), j);
                    nextCode = eoiCode + 1;
                    curCodeSize = minCodeSize + 1;
                }
                
                // Increase code size?
                if (nextCode === (1 << curCodeSize) && curCodeSize < 12) {
                    curCodeSize++;
                }
                
                prefix = String(pixel);
            }
        }
        
        if (prefix !== "") this.writeBits(output, dict.get(prefix), curCodeSize, false);
        this.writeBits(output, eoiCode, curCodeSize, false);
        this.writeBits(output, 0, 0, false, true); // Flush
    }

    // Bit writing helper closure
    writeBits(output, code, numBits, reset, flush) {
        if (!this.bitState || reset) {
            this.bitState = { datum: 0, bits: 0, buffer: [] };
        }
        if (flush) {
             if (this.bitState.bits > 0) {
                 this.bitState.buffer.push(this.bitState.datum & 0xFF);
                 this.flushBuffer(output, this.bitState.buffer);
                 this.bitState.datum = 0; this.bitState.bits = 0;
             }
             return;
        }

        this.bitState.datum += code << this.bitState.bits;
        this.bitState.bits += numBits;
        while (this.bitState.bits >= 8) {
            this.bitState.buffer.push(this.bitState.datum & 0xFF);
            this.bitState.datum >>= 8;
            this.bitState.bits -= 8;
            if (this.bitState.buffer.length === 254) {
                this.flushBuffer(output, this.bitState.buffer);
            }
        }
    }

    flushBuffer(output, buffer) {
        if (buffer.length > 0) {
            output.push(buffer.length);
            for (let b of buffer) output.push(b);
            buffer.length = 0;
        }
    }
}