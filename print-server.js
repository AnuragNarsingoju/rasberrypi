const express = require('express');
const sharp = require('sharp');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const fs = require('fs').promises;
const execPromise = util.promisify(exec);
const cors = require('cors');

const app = express();
const port = 3003;

app.use(cors());
app.use(express.json());

async function listPrinters() {
    try {
        const { stdout } = await execPromise('lpstat -p');
        return stdout.split('\n')
            .filter(line => line.startsWith('printer'))
            .map(line => line.split(' ')[1]);
    } catch (error) {
        console.error('Error listing printers:', error);
        throw error;
    }
}

async function createInvoiceImage(baseImagePath, invoiceData) {
    try {
        const metadata = await sharp(baseImagePath).metadata();
        const originalWidth = metadata.width;
        const originalHeight = metadata.height;
        
        const scaleX = originalWidth / 420;
        const scaleY = originalHeight / 595;
        const dateSection = {
            x: 300 * scaleX,
            y: 80 * scaleY,
            width: 100 * scaleX,
            height: 30 * scaleY
        };

        const priceSection = {
            x: 30 * scaleX,
            y: 100 * scaleY,
            width: 120 * scaleX,
            height: 30 * scaleY
        };

        const itemHeaderSection = {
            x: 10 * scaleX,
            y: 140 * scaleY,
            width: originalWidth - (20 * scaleX),
            height: 30 * scaleY
        };

        // Format date
        const [datePart] = invoiceData.time.split(" ");
        const [year, month, day] = datePart.split("/");
        const formattedDate = `${day}-${month}-${year}`;

        // Create text overlays for items
        let itemsText = '';
        let topPosition = 130 * scaleY;

        for (let i = 0; i < invoiceData.item.length; i++) {
            if (invoiceData.grossweight[i] > 0) {
                const itemCode = invoiceData.Codes && invoiceData.Codes[i] ? 
                    `(Product Code: ${invoiceData.Codes[i]})` : '';

                const itemRow = {
                    y: topPosition,
                    height: 40 * scaleY,
                    item: {
                        x: 11 * scaleX,
                        width: 80 * scaleX
                    },
                    weight: {
                        x: 95 * scaleX,
                        width: 82 * scaleX
                    },
                    wastage: {
                        x: 180 * scaleX,
                        width: 76 * scaleX
                    },
                    making: {
                        x: 255 * scaleX,
                        width: 80 * scaleX
                    },
                    price: {
                        x: 335 * scaleX,
                        width: 80 * scaleX
                    }
                };
                
                itemsText += `
                    <!-- Item Row Container -->
                    <rect x="25" y="${itemRow.y}" width="${originalWidth-55}" height="${itemRow.height}"  
                    fill="rgba(0, 0, 0, 0)"/>

                    <!-- Item Name Column -->
                    <rect x="${itemRow.item.x}" y="${itemRow.y}" 
                          width="${itemRow.item.width}" height="${itemRow.height}" 
                          fill="rgba(0, 0, 0, 0)" />
                    <text x="${itemRow.item.x + (itemRow.item.width/2)}" 
                          y="${itemRow.y + (itemRow.height/2)}"
                          font-size="${8 * scaleY}" font-weight="550"
                          text-anchor="middle" alignment-baseline="middle">
                        ${invoiceData.item[i]}
                        ${itemCode ? `
                            <tspan x="${itemRow.item.x + (itemRow.item.width/2)}" 
                                   dy="${12 * scaleY}" 
                                   font-size="${6 * scaleY}" font-weight="550">
                                ${itemCode}
                            </tspan>
                        ` : ''}
                    </text>

                    <!-- Weight Column -->
                    <rect x="${itemRow.weight.x}" y="${itemRow.y}" 
                          width="${itemRow.weight.width}" height="${itemRow.height}" 
                          fill="rgba(0, 0, 0, 0)" />
                    <text x="${itemRow.weight.x + (itemRow.weight.width/2)}" 
                          y="${itemRow.y + (itemRow.height/2)}"
                          font-size="${8 * scaleY}" font-weight="550"
                          text-anchor="middle" alignment-baseline="middle">
                        ${invoiceData.grossweight[i]} grams
                    </text>

                    <!-- Wastage Column -->
                    <rect x="${itemRow.wastage.x}" y="${itemRow.y}" 
                          width="${itemRow.wastage.width}" height="${itemRow.height}" 
                          fill="rgba(0, 0, 0, 0)" />
                    <text x="${itemRow.wastage.x + (itemRow.wastage.width/2)}" 
                          y="${itemRow.y + (itemRow.height/2)}"
                          font-size="${8 * scaleY}" font-weight="550"
                          text-anchor="middle" alignment-baseline="middle">
                        ${invoiceData.wastage[i] > 0 ? `${invoiceData.wastage[i]} grams` : '----'}
                    </text>

                    <!-- Making Charges Column -->
                    <rect x="${itemRow.making.x}" y="${itemRow.y}" 
                          width="${itemRow.making.width}" height="${itemRow.height}" 
                          fill="rgba(0, 0, 0, 0)" />
                    <text x="${itemRow.making.x + (itemRow.making.width/2)}" 
                          y="${itemRow.y + (itemRow.height/2)}"
                          font-size="${8 * scaleY}" font-weight="550"
                          text-anchor="middle" alignment-baseline="middle">
                        RS. ${invoiceData.making_charges[i]}
                    </text>

                    <!-- Price Column -->
                    <rect x="${itemRow.price.x+10}" y="${itemRow.y}" 
                          width="${itemRow.price.width-10}" height="${itemRow.height}" 
                          fill="rgba(0, 0, 0, 0)" />
                    <text x="${itemRow.price.x + (itemRow.price.width/2)}" 
                          y="${itemRow.y + (itemRow.height/2)}"
                          font-size="${8 * scaleY}" font-weight="550"
                          text-anchor="middle" alignment-baseline="middle">
                        RS. ${invoiceData.item_price[i]}
                    </text>
                `;
                topPosition += 45 * scaleY;
            }
        }

        // Create complete SVG overlay
        const svgOverlay = `
            <svg width="${originalWidth}" height="${originalHeight}">
                <style>
                    text { 
                        font-family: Arial, sans-serif;
                        fill: black;
                        letter-spacing: 0.2px;
                    }
                </style>

                <!-- Date Section -->
                <rect x="${dateSection.x+90}" y="${dateSection.y-20}" 
                      width="${dateSection.width}" height="${dateSection.height}" 
                      fill="rgba(0, 0, 0, 0)" />
                <text x="${dateSection.x+90 + (dateSection.width/2)}" 
                      y="${dateSection.y + (dateSection.height/2)-20}"
                      font-size="${8 * scaleY}" font-weight="bold"
                      text-anchor="middle" alignment-baseline="middle">
                    ${formattedDate}
                </text>

                <!-- Price Section -->
                <rect x="${priceSection.x-110}" y="${priceSection.y-60}" 
                      width="${priceSection.width/2}" height="${priceSection.height-100}" 
                      fill="rgba(0, 0, 0, 0.1)" />
                <text x="${priceSection.x-110 + (priceSection.width/2)}" 
                      y="${priceSection.y + (priceSection.height/2)-60}"
                      font-size="${8 * scaleY}" font-weight="bold"
                      text-anchor="middle" alignment-baseline="middle">
                    ${invoiceData.metal === 'gold' ? invoiceData.Gold_price : invoiceData.silver_price}
                </text>

                <!-- Items Section -->
                ${itemsText}

                <!-- Totals Section -->
                <rect x="${325 * scaleX}" y="${457 * scaleY}" 
                    width="${60 * scaleX}" height="${30 * scaleY}" 
                    fill="rgba(0, 0, 0, 0)" />
                <text x="${(330 + 60 / 2) * scaleX}" y="${(457 + 31 / 2) * scaleY}" 
                    font-size="${8 * scaleY}" font-weight="bold"
                    text-anchor="middle" dominant-baseline="middle">
                    ${invoiceData.total.reduce((acc, val) => acc + parseInt(val), 0)}
                </text>


                ${invoiceData.Discount > 0 ? `
                    <rect x="${302 * scaleX}" y="${475 * scaleY}" 
                          width="${60 * scaleX}" height="${20 * scaleY}" 
                          fill="rgba(0, 0, 0, 0)" />
                    <text x="${(302 + 60 / 2) * scaleX}" y="${(475 + 20 / 2) * scaleY}" 
                          font-size="${8 * scaleY}" font-weight="bold"
                          text-anchor="middle" dominant-baseline="middle">
                          Discount  : - ${invoiceData.Discount}
                    </text>
                ` : ''}

                ${parseFloat(invoiceData.os_nw) > 0 ? `
                    <rect x="${101 * scaleX}" y="${(invoiceData.Discount > 0 ? 486 : 478) * scaleY}" 
                          width="${300 * scaleX}" height="${20 * scaleY}" 
                          fill="rgba(0, 0, 0, 0)" />
                    <text x="${(101 + 300 / 2) * scaleX}" y="${(invoiceData.Discount > 0 ? 487 + 20 / 2 : 479 + 20 / 2) * scaleY}" 
                          font-size="${8 * scaleY}" font-weight="bold"
                          text-anchor="middle" dominant-baseline="middle">
                        Old Metal Net weight  : ${parseFloat(invoiceData.os_nw).toFixed(2)} grams | Old Metal Amount  : - ${invoiceData.os_price}
                    </text>
                ` : ''}

                <!-- Sale Price Section -->
                    <rect x="${311 * scaleX}" y="${(invoiceData.Discount > 0 ? 504 : 487) * scaleY}" 
                        width="${100 * scaleX}" height="${20 * scaleY}" 
                        fill="rgba(0, 0, 0, 0.1)" />
                    <text x="${(311 + 100 / 2) * scaleX}" y="${(invoiceData.Discount > 0 ? 504 + 20 / 2 : 504 + 20 / 2) * scaleY}" 
                        font-size="${9 * scaleY}" font-weight="bold" text-anchor="middle" dominant-baseline="middle">
                        ${invoiceData['sale price']}
                    </text>

                
            </svg>
        `;

        const processedImage = await sharp(baseImagePath)
            .composite([{
                input: Buffer.from(svgOverlay),
                top: 0,
                left: 0
            }])
            .withMetadata()
            .png({ 
                quality: 100,
                compression: 0,
                force: true
            })
            .toBuffer();

        return processedImage;
    } catch (error) {
        console.error('Error creating invoice image:', error);
        throw error;
    }
}

app.get('/printers', async (req, res) => {
    try {
        const printers = await listPrinters();
        res.json({ printers });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/print', async (req, res) => {
    try {
        const invoiceData = req.body;
        
        if (!invoiceData.item || !invoiceData.time) {
            return res.status(400).json({ error: 'Missing required invoice data' });
        }

        const tempDir = path.join(__dirname, 'temp');
        await fs.mkdir(tempDir, { recursive: true });
        const tempImagePath = path.join(tempDir, `invoice-${Date.now()}.png`);
        
        const baseImagePath = path.join(__dirname, 'templates', 'nbj.png');
        const printImage = await createInvoiceImage(baseImagePath, invoiceData);
        await fs.writeFile(tempImagePath, printImage);

        const printers = await listPrinters();
        const printerName = printers[2];

        if (!printerName) {
            throw new Error('No printer found');
        }

        // Updated print command with quality settings
        const printCommand = `lp -d ${printerName} -o media=A5 -o fit-to-page -o quality=high -o resolution=600x600 ${tempImagePath}`;
        await execPromise(printCommand);

        // Save a copy for quality verification (optional)
        const debugPath = path.join(__dirname, 'debug', `invoice-${Date.now()}.png`);
        await fs.mkdir(path.join(__dirname, 'debug'), { recursive: true });
        await fs.copyFile(tempImagePath, debugPath);

        await fs.unlink(tempImagePath);

        res.json({ 
            success: true, 
            message: `Invoice printed successfully to ${printerName}`,
            printer: printerName,
            debugPath // For development purposes
        });
    } catch (error) {
        console.error('Error printing invoice:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(port, () => {
    console.log(`Print server running on port ${port}`);
    console.log(`Access the server at http://localhost:${port}`);
});