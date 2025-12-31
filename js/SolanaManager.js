console.log("SolanaManager.js file loaded");

/**
 * Solana Integration Manager
 * Handles wallet connection and blockchain interactions (Devnet)
 */
class SolanaManager {
    constructor(editor) {
        this.editor = editor;
        
        if (typeof solanaWeb3 === 'undefined') {
            console.error("Solana Web3 library not loaded! Check your internet connection or CDN link.");
            return;
        }

        // Expanded debug check
        const hasIrys = typeof Irys !== 'undefined';
        const hasWebIrys = typeof WebIrys !== 'undefined';
        const hasBundlr = typeof Bundlr !== 'undefined';
        console.log("Irys/Bundlr SDK Status:", { hasIrys, hasWebIrys, hasBundlr, windowIrys: !!window.Irys });

        this.connection = new solanaWeb3.Connection(solanaWeb3.clusterApiUrl('devnet'), 'confirmed');
        this.walletAddress = null;
        this.provider = null;

        this.init();
    }

    init() {
        console.log("SolanaManager instance initializing");
        this.setupEventListeners();
        // Check if already connected after a small delay to allow for injection
        setTimeout(() => {
            this.checkIfWalletIsConnected();
        }, 1000);
    }

    setupEventListeners() {
        const connectBtn = document.getElementById('connect-wallet-btn');
        if (connectBtn) {
            connectBtn.onclick = (e) => {
                e.stopPropagation();
                if (this.walletAddress) {
                    this.toggleMenu();
                } else {
                    this.connect();
                }
            };
        }

        window.addEventListener('click', () => {
            const container = document.querySelector('.wallet-dropdown');
            if (container) container.classList.remove('open');
        });
    }

    toggleMenu() {
        const container = document.querySelector('.wallet-dropdown');
        if (container) {
            container.classList.toggle('open');
        }
    }

    async checkIfWalletIsConnected() {
        try {
            const provider = this.getProvider();
            if (provider) {
                console.log("Attempting auto-connect...");
                const response = await provider.connect({ onlyIfTrusted: true });
                this.handleConnect(response.publicKey.toString());
            }
        } catch (error) {
            // Not connected yet, that's fine
        }
    }

    async connect() {
        try {
            const provider = this.getProvider();
            console.log("Provider detected:", !!provider);
            if (!provider) {
                console.log("No provider found, redirecting to Phantom...");
                window.open("https://phantom.app/", "_blank");
                return;
            }
            console.log("Requesting provider connection...");
            const response = await provider.connect();
            this.handleConnect(response.publicKey.toString());
        } catch (error) {
            console.error("Wallet connection failed:", error);
        }
    }

    async disconnect() {
        try {
            if (this.provider) {
                await this.provider.disconnect();
                this.handleDisconnect();
            }
        } catch (error) {
            console.error("Wallet disconnect failed:", error);
        }
    }

    handleConnect(publicKey) {
        this.walletAddress = publicKey;
        this.provider = this.getProvider();
        
        const connectBtn = document.getElementById('connect-wallet-btn');
        if (connectBtn) {
            connectBtn.innerText = `${publicKey.slice(0, 4)}...${publicKey.slice(-4)}`;
            connectBtn.style.background = 'var(--success)';
            connectBtn.title = `Connected: ${publicKey}`;
        }

        const mintItem = document.getElementById('mint-menu-item');
        if (mintItem) mintItem.style.display = 'flex';

        console.log("Connected to Solana Devnet:", publicKey);
    }

    handleDisconnect() {
        this.walletAddress = null;
        const container = document.querySelector('.wallet-dropdown');
        if (container) container.classList.remove('open');

        const connectBtn = document.getElementById('connect-wallet-btn');
        if (connectBtn) {
            connectBtn.innerText = 'Connect Wallet';
            connectBtn.style.background = 'var(--primary)';
            connectBtn.title = '';
        }

        const mintItem = document.getElementById('mint-menu-item');
        if (mintItem) mintItem.style.display = 'none';

        console.log("Disconnected from Solana");
    }

    openMintModal() {
        const modal = document.getElementById('mint-nft-modal');
        if (modal) {
            modal.classList.add('open');
            
            // Reset Views
            document.getElementById('mint-initial-view').style.display = 'flex';
            document.getElementById('mint-success-view').style.display = 'none';
            this.updateMintStatus("Idle", false);

            // Set default name from project title
            const projectTitle = document.querySelector('.project-title').innerText;
            document.getElementById('nft-name').value = projectTitle;
            document.getElementById('nft-symbol').value = 'FORGE';

            // Generate Preview Image
            const previewImg = document.getElementById('mint-preview-img');
            const canvas = this.editor.generateFrameCanvas(this.editor.currentFrameIndex);
            
            if (canvas && canvas.width > 0 && canvas.height > 0) {
                const dataUrl = canvas.toDataURL();
                previewImg.src = dataUrl;
                console.log("NFT Preview set successfully. Data length:", dataUrl.length);
            } else {
                console.error("Failed to generate preview canvas. Width/Height:", canvas?.width, canvas?.height);
            }
        }
    }

    closeMintModal() {
        const modal = document.getElementById('mint-nft-modal');
        if (modal) modal.classList.remove('open');
        this.updateMintStatus("Idle", false);
    }

    updateMintStatus(text, show = true) {
        const statusEl = document.getElementById('mint-status');
        const textEl = document.getElementById('mint-status-text');
        if (statusEl && textEl) {
            statusEl.style.display = show ? 'block' : 'none';
            textEl.innerText = text;
        }
    }

    async startMetadataUpload() {
        const name = document.getElementById('nft-name').value;
        const symbol = document.getElementById('nft-symbol').value;
        const description = document.getElementById('nft-description').value;

        if (!name || !symbol) {
            alert("Please enter a name and symbol for your NFT.");
            return;
        }

        this.updateMintStatus("Generating High-Res Image (50x)...");
        
        // Generate the base canvas
        const rawCanvas = this.editor.generateFrameCanvas(this.editor.currentFrameIndex);
        
        // Scale up 50x (Match the export menu's high-res option)
        const scale = 50;
        const scaledCanvas = document.createElement('canvas');
        scaledCanvas.width = rawCanvas.width * scale;
        scaledCanvas.height = rawCanvas.height * scale;
        const ctx = scaledCanvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(rawCanvas, 0, 0, scaledCanvas.width, scaledCanvas.height);
        
        scaledCanvas.toBlob(async (blob) => {
            try {
                this.updateMintStatus("Connecting to Arweave (Irys)...");
                
                // 1. Initialize Irys/Bundlr
                const network = "devnet";
                const currency = "solana"; // Using 'currency' for stable Bundlr version
                
                // Get provider from current wallet
                const provider = this.getProvider();
                if (!provider) throw new Error("Wallet provider not found");

                // Compatibility Shim: Irys SDK v0.1.x expects 'sendTransaction' but modern wallets have 'signAndSendTransaction'
                if (provider && !provider.sendTransaction && provider.signAndSendTransaction) {
                    console.log("Applying wallet compatibility shim...");
                    provider.sendTransaction = async (tx) => {
                        return provider.signAndSendTransaction(tx);
                    };
                }

                // Initialize (Handle different global names and module exports)
                let irys;
                const lib = window.Irys || window.WebIrys || window.Bundlr || window.WebBundlr;
                
                if (lib) {
                    // Try to find the constructor (WebIrys, WebBundlr, or the lib itself)
                    let ctor = lib.WebIrys || lib.WebBundlr || lib.default || lib;
                    
                    // If ctor is still an object and has a default, use that
                    if (typeof ctor !== 'function' && ctor.default) ctor = ctor.default;

                    console.log("Instantiating with ctor type:", typeof ctor);
                    
                    // Modern Irys SDK (v0.1.x+) uses object arguments
                    irys = new ctor({ 
                        url: "https://devnet.irys.xyz", 
                        token: "solana", 
                        wallet: { provider },
                        config: { providerUrl: "https://api.devnet.solana.com" }
                    });
                } else {
                    throw new Error("Irys/Bundlr SDK not found in global scope.");
                }

                await irys.ready();
                
                // 2. Upload Image
                this.updateMintStatus("Uploading Image to Arweave...");
                
                // Convert Blob to Uint8Array
                const arrayBuffer = await blob.arrayBuffer();
                const imageBuffer = new Uint8Array(arrayBuffer);
                const imageTags = [{ name: "Content-Type", value: "image/png" }];
                
                // Check price
                const price = await irys.getPrice(imageBuffer.length);
                const balance = await irys.getLoadedBalance();
                
                if (price.isGreaterThan(balance)) {
                    this.updateMintStatus("Funding Irys Node with Devnet SOL...");
                    await irys.fund(price.multipliedBy(1.2).toFixed(0)); 
                }

                // Low-level API: Create -> Sign -> Upload
                const imageTx = irys.createTransaction(imageBuffer, { tags: imageTags });
                await imageTx.sign();
                const imageReceipt = await imageTx.upload();
                
                const imageUri = `https://arweave.net/${imageReceipt.id}`;
                console.log("Image uploaded:", imageUri);

                // 3. Upload Metadata
                this.updateMintStatus("Uploading Metadata JSON...");
                const metadata = {
                    name: name,
                    symbol: symbol,
                    description: description,
                    image: imageUri,
                    attributes: [
                        { trait_type: "Software", value: "PixelForge" },
                        { trait_type: "Dimensions", value: `${this.editor.gridWidth}x${this.editor.gridHeight}` },
                        { trait_type: "Scale", value: "50x" }
                    ],
                    properties: {
                        files: [{ uri: imageUri, type: "image/png" }],
                        category: "image"
                    }
                };

                const metadataString = JSON.stringify(metadata);
                const metadataBuffer = new TextEncoder().encode(metadataString);
                const metadataTags = [{ name: "Content-Type", value: "application/json" }];
                
                const metaTx = irys.createTransaction(metadataBuffer, { tags: metadataTags });
                await metaTx.sign();
                const metadataReceipt = await metaTx.upload();
                
                const metadataUri = `https://arweave.net/${metadataReceipt.id}`;
                console.log("Metadata uploaded:", metadataUri);

                this.updateMintStatus("Ready to Mint!");
                const mintBtn = document.getElementById('start-mint-btn');
                if (mintBtn) {
                    mintBtn.innerText = "Finalize Mint on Solana";
                    mintBtn.onclick = () => this.mintNFT({...metadata, uri: metadataUri});
                }

            } catch (error) {
                console.error("Irys Upload Error:", error);
                this.updateMintStatus("Upload Failed! Make sure you have Devnet SOL.");
                alert("Storage upload failed. Common cause: Irys node requires funding or network congestion. Check console.");
            }
        }, 'image/png');
    }

    async mintNFT(metadata) {
        if (!this.walletAddress) return;
        
        this.updateMintStatus("Preparing NFT Transaction...");
        
        try {
            const connection = this.connection;
            const buyerPublicKey = new solanaWeb3.PublicKey(this.walletAddress);
            const metadataUri = metadata.uri; // The permanent Arweave link
            
            // 1. NFT Mint Identity
            const mintKeypair = solanaWeb3.Keypair.generate();
            const mint = mintKeypair.publicKey;
// ... (rest of function)
            const TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
            const ASSOCIATED_TOKEN_PROGRAM_ID = new solanaWeb3.PublicKey("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
            const METADATA_PROGRAM_ID = new solanaWeb3.PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

            // 2. Addresses
            const [metadataAddress] = await solanaWeb3.PublicKey.findProgramAddress(
                [new TextEncoder().encode("metadata"), METADATA_PROGRAM_ID.toBytes(), mint.toBytes()],
                METADATA_PROGRAM_ID
            );

            const [ata] = await solanaWeb3.PublicKey.findProgramAddress(
                [buyerPublicKey.toBytes(), TOKEN_PROGRAM_ID.toBytes(), mint.toBytes()],
                ASSOCIATED_TOKEN_PROGRAM_ID
            );

            const transaction = new solanaWeb3.Transaction();
            const rent = await connection.getMinimumBalanceForRentExemption(82);

            // A. Create Account
            transaction.add(solanaWeb3.SystemProgram.createAccount({
                fromPubkey: buyerPublicKey, newAccountPubkey: mint, lamports: rent, space: 82, programId: TOKEN_PROGRAM_ID,
            }));

            // B. Init Mint
            const initMintData = new Uint8Array(1 + 1 + 32 + 1 + 32);
            initMintData[0] = 0; initMintData[1] = 0; 
            initMintData.set(buyerPublicKey.toBytes(), 2);
            transaction.add(new solanaWeb3.TransactionInstruction({
                keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: solanaWeb3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false }],
                programId: TOKEN_PROGRAM_ID, data: initMintData
            }));

            // C. Create ATA
            transaction.add(new solanaWeb3.TransactionInstruction({
                keys: [
                    { pubkey: buyerPublicKey, isSigner: true, isWritable: true },
                    { pubkey: ata, isSigner: false, isWritable: true },
                    { pubkey: buyerPublicKey, isSigner: false, isWritable: false },
                    { pubkey: mint, isSigner: false, isWritable: false },
                    { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
                    { pubkey: solanaWeb3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
                ],
                programId: ASSOCIATED_TOKEN_PROGRAM_ID, data: new Uint8Array(0)
            }));

            // D. Mint 1
            transaction.add(new solanaWeb3.TransactionInstruction({
                keys: [{ pubkey: mint, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true }, { pubkey: buyerPublicKey, isSigner: true, isWritable: false }],
                programId: TOKEN_PROGRAM_ID, data: new Uint8Array([7, 1, 0, 0, 0, 0, 0, 0, 0])
            }));

            // E. Metadata
            const metadataData = this.buildMetadataData(metadata.name, metadata.symbol, metadata.uri);
            transaction.add(new solanaWeb3.TransactionInstruction({
                keys: [
                    { pubkey: metadataAddress, isSigner: false, isWritable: true },
                    { pubkey: mint, isSigner: false, isWritable: false },
                    { pubkey: buyerPublicKey, isSigner: true, isWritable: false }, // Mint Authority
                    { pubkey: buyerPublicKey, isSigner: true, isWritable: true },  // Payer
                    { pubkey: buyerPublicKey, isSigner: false, isWritable: false }, // Update Authority
                    { pubkey: solanaWeb3.SystemProgram.programId, isSigner: false, isWritable: false },
                    { pubkey: solanaWeb3.SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
                ],
                programId: METADATA_PROGRAM_ID,
                data: metadataData
            }));

            this.updateMintStatus("Awaiting Wallet Signature...");
            const { blockhash } = await connection.getLatestBlockhash();
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = buyerPublicKey;
            transaction.partialSign(mintKeypair);

            const { signature } = await this.provider.signAndSendTransaction(transaction);
            
            this.updateMintStatus("Confirming...");
            await connection.confirmTransaction(signature);
            
            this.updateMintStatus("SUCCESS!");
            
            // Show Success View
            document.getElementById('mint-initial-view').style.display = 'none';
            document.getElementById('mint-success-view').style.display = 'flex';
            
            // Populate Success Data
            document.getElementById('success-mint-address').innerText = mint.toString();
            document.getElementById('success-tx-link').href = `https://solana.fm/tx/${signature}?cluster=devnet-solana`;

        } catch (error) {
            console.error("Minting Error:", error);
            this.updateMintStatus("Error: See Console");
            alert("Minting failed. Standard reason: Simulation Error. Trying again usually helps!");
        }
    }

    buildMetadataData(name, symbol, uri) {
        const encoder = new TextEncoder();
        const n = encoder.encode(name);
        const s = encoder.encode(symbol);
        const u = encoder.encode(uri);

        // Standard Metaplex V3 layout: 
        // [1] Index 33 
        // [4+n] Name (Borsh String)
        // [4+s] Symbol (Borsh String)
        // [4+u] URI (Borsh String)
        // [2] Fee (u16)
        // [1] creators (Option)
        // [1] collection (Option)
        // [1] uses (Option)
        // [1] isMutable (bool)
        // [1] collectionDetails (Option - The missing byte!)
        const size = 1 + (4 + n.length) + (4 + s.length) + (4 + u.length) + 2 + 1 + 1 + 1 + 1 + 1;
        const data = new Uint8Array(size);
        const view = new DataView(data.buffer);
        let offset = 0;

        view.setUint8(offset++, 33); // Index

        view.setUint32(offset, n.length, true); offset += 4;
        data.set(n, offset); offset += n.length;

        view.setUint32(offset, s.length, true); offset += 4;
        data.set(s, offset); offset += s.length;

        view.setUint32(offset, u.length, true); offset += 4;
        data.set(u, offset); offset += u.length;

        view.setUint16(offset, 0, true); offset += 2; 
        view.setUint8(offset++, 0); 
        view.setUint8(offset++, 0); 
        view.setUint8(offset++, 0); 
        view.setUint8(offset++, 1); // isMutable
        view.setUint8(offset++, 0); // collectionDetails

        return data;
    }

    copyMintAddress(btn) {
        const address = document.getElementById('success-mint-address').innerText;
        navigator.clipboard.writeText(address).then(() => {
            if (!btn) return;
            const originalText = btn.innerText;
            btn.innerText = "✅";
            setTimeout(() => btn.innerText = originalText, 2000);
        });
    }

    getProvider() {
        // 1. Check for dedicated wallet objects (Most reliable)
        if (window.phantom?.solana) return window.phantom.solana;
        if (window.solflare) return window.solflare;
        if (window.backpack) return window.backpack;
        if (window.magicEden?.solana) return window.magicEden.solana;
        if (window.jupiter) return window.jupiter;

        // 2. Check for the standard 'solana' object injected by many wallets
        if (window.solana) {
            // Some wallets might inject but not be ready, or be multiple
            if (window.solana.isPhantom || window.solana.isSolflare || window.solana.isBackpack || window.solana.isMagicEden) {
                return window.solana;
            }
        }

        return null;
    }
}