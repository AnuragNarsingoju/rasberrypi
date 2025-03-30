const express = require('express');
const sharp = require('sharp');
const path = require('path');
const util = require('util');
const fs = require('fs').promises;
const cors = require('cors');
const { exec } = require('child_process');
const execPromise = util.promisify(exec);
const app = express();
const port = 5010;
const recentPrintRequests = new Map();
const corsOptions = {
    origin: ['https://www.nbjshop.in'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Cookie']
};

const { PDFDocument } = require('pdf-lib');

app.use(cors(corsOptions));

const validateOrigin = (req, res, next) => {
    const allowedOrigins = ['https://www.nbjshop.in'];
    if (!allowedOrigins.includes(req.headers.origin)) {
        return res.status(403).json({ error: 'Unauthorized request' });
    }
    next();
};
app.use(validateOrigin);


app.use(express.json());

async function listPrinters() {
    try {
        let command;
        command = 'powershell.exe -Command "Get-Printer | Select-Object -ExpandProperty Name"';
        const { stdout } = await execPromise(command);
        const printers = stdout
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0);
        return printers;
    } catch (error) {
        console.error('Error listing printers:', error);
        return { error: error.message };
    }
}



async function saveInvoiceAsPDF(baseImagePath, invoiceData, outputPDFPath) {

    let printImage;
    if(invoiceData.metal === 'gold'){
        printImage = await createGoldInvoiceImage(baseImagePath, invoiceData);
    }
    else{
        printImage = await createInvoiceImage(baseImagePath, invoiceData);
    }

    const pdfDoc = await PDFDocument.create();
    const page = invoiceData.metal === 'gold' ? pdfDoc.addPage([210 * 2.83465, 148 * 2.83465]) : pdfDoc.addPage([148 * 2.83465, 210 * 2.83465]); 

    const image = await pdfDoc.embedPng(printImage);
    page.drawImage(image, {
        x: 0,
        y: 0,
        width: page.getWidth(),
        height: page.getHeight()
    });

    const pdfBytes = await pdfDoc.save();
    await fs.writeFile(outputPDFPath, pdfBytes);
}

async function generateInvoicePDF(invoiceData) {
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });

    const baseImagePath = path.join(__dirname, 'templates', 'nbj.png');
    const tempPDFPath = path.join(tempDir, `invoice.pdf`);

    await saveInvoiceAsPDF(baseImagePath, invoiceData, tempPDFPath);

    return tempPDFPath;
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
                        x: 8 * scaleX,
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
                        x: 253 * scaleX,
                        width: 80 * scaleX
                    },
                    price: {
                        x: 336 * scaleX,
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
                <rect x="${dateSection.x+155}" y="${dateSection.y-36}" 
                      width="${dateSection.width}" height="${dateSection.height}" 
                      fill="rgba(0, 0, 0, 0)" />
                <text x="${dateSection.x+155 + (dateSection.width/2)}" 
                      y="${dateSection.y + (dateSection.height/2)-36}"
                      font-size="${8 * scaleY}" font-weight="bold"
                      text-anchor="middle" alignment-baseline="middle">
                    ${formattedDate}
                </text>

                <!-- Price Section -->
                <rect x="${priceSection.x-190}" y="${priceSection.y-60}" 
                      width="${priceSection.width/2}" height="${priceSection.height-100}" 
                      fill="rgba(0, 0, 0, 0)" />
                <text x="${priceSection.x-190 + (priceSection.width/2)}" 
                      y="${priceSection.y + (priceSection.height/2)-105}"
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

async function generateGoldInvoicePDF(invoiceData) {
    const tempDir = path.join(__dirname, 'temp');
    await fs.mkdir(tempDir, { recursive: true });
    let baseImagePath;
    if (invoiceData.cgst > 0 && invoiceData.items.some(item => item.stoneweight > 0)) {
        baseImagePath = path.join(__dirname, 'templates', 'gst-gold-stone.png');
    } 
    else if (invoiceData.cgst > 0) {
        baseImagePath = path.join(__dirname, 'templates', 'gst-gold.png');
    } 
    else if ((invoiceData.cname || invoiceData.caddress || invoiceData.cmobile) && invoiceData.items.some(item => item.stoneweight > 0)) {
        baseImagePath = path.join(__dirname, 'templates', 'non-gst-gold-with-stone.png');
    } 
    else if ((invoiceData.cname === "" && invoiceData.caddress === "" && invoiceData.cmobile === "") && invoiceData.items.some(item => item.stoneweight > 0)) {
        baseImagePath = path.join(__dirname, 'templates', 'Nc-non-gst-gold-with-stone.png');
    } 
    else if (invoiceData.cname || invoiceData.caddress || invoiceData.cmobile) {
        baseImagePath = path.join(__dirname, 'templates', 'Non-gst-gold.png');
    } 
    else {
        baseImagePath = path.join(__dirname, 'templates', 'NC-Non-gst-gold.png');
    }
    const tempPDFPath = path.join(tempDir, `invoice.pdf`);
    await saveInvoiceAsPDF(baseImagePath, invoiceData, tempPDFPath);
    return tempPDFPath;
}
async function createGoldInvoiceImage(baseImagePath, invoiceData) {
    try {
        const metadata = await sharp(baseImagePath).metadata();
        const originalWidth = metadata.width;
        const originalHeight = metadata.height;
        
        const scaleX = originalWidth / 595;  
        const scaleY = originalHeight / 420; 

        const wrapText = (text, maxWidth, fontSize) => {
            const words = text.toString().split(' ');
            const lines = [];
            let currentLine = words[0];

            for(let i = 1; i < words.length; i++) {
                const word = words[i];
                const width = (currentLine.length + word.length + 1) * (fontSize * 0.6);
                if(width < maxWidth) {
                    currentLine += " " + word;
                } else {
                    lines.push(currentLine);
                    currentLine = word;
                }
            }
            lines.push(currentLine);
            return lines;
        };

        // Customer Details Section - moved to left side
        const customerSection = {
            x: 20 * scaleX,
            y: 70 * scaleY,
            width: 250 * scaleX,
            height: 80 * scaleY
        };

        // Date and Invoice Section - moved to right side
        const dateSection = {
            x: originalWidth - (180 * scaleX),
            y: 70 * scaleY,
            width: 160 * scaleX,
            height: 80 * scaleY
        };

        
        // Create text overlays for items
        let itemsText = '';
        let topPosition = 155 * scaleY;  // Adjusted starting position

        const hasStoneWeight = invoiceData.items.some(item => item.stoneweight > 0);

        for (let i = 0; i < invoiceData.items.length; i++) {
            const item = invoiceData.items[i];
            if (item.grosswt > 0) {
                const itemRow = {
                    y: topPosition,
                    height: 30 * scaleY,
                    item: {
                        x: 40 * scaleX,
                        width: 100 * scaleX
                    },
                    qty: {
                        x: 150 * scaleX,
                        width: 40 * scaleX
                    },
                    hsn: {
                        x: 200 * scaleX,
                        width: 60 * scaleX
                    },
                    grossWt: {
                        x: (invoiceData.cgst>0 && hasStoneWeight) ? 231 * scaleX : (invoiceData.cgst>0 && !hasStoneWeight) ? 231 * scaleX  : hasStoneWeight ? 196 * scaleX : 196 * scaleX ,
                        width: (invoiceData.cgst > 0 && hasStoneWeight) ? 55 * scaleX : (invoiceData.cgst > 0 && !hasStoneWeight) ? 59 * scaleX  : hasStoneWeight ? 56 * scaleX : 76 * scaleX
                    },

                    stoneWt: {
                        x: (invoiceData.cgst>0 && hasStoneWeight) ? 286 * scaleX : hasStoneWeight ? 252 * scaleX : 0,
                        width:(invoiceData.cgst>0 && hasStoneWeight) ? 45 * scaleX : hasStoneWeight ? 55 * scaleX : 0
                    },

                    netWt: {
                        x: (invoiceData.cgst>0 && hasStoneWeight) ? 332 * scaleX : (invoiceData.cgst>0 && !hasStoneWeight) ? 290 * scaleX  : hasStoneWeight ? 307 * scaleX : 272 * scaleX ,
                        width: (invoiceData.cgst > 0 && hasStoneWeight) ? 56 * scaleX : (invoiceData.cgst > 0 && !hasStoneWeight) ? 60 * scaleX  : hasStoneWeight ? 55 * scaleX : 74 * scaleX
                    },

                    rate: {
                        x: (invoiceData.cgst>0 && hasStoneWeight) ? 388 * scaleX : (invoiceData.cgst>0 && !hasStoneWeight) ? 350 * scaleX  : hasStoneWeight ? 363 * scaleX : 345 * scaleX  ,
                        width: (invoiceData.cgst > 0 && hasStoneWeight) ? 45 * scaleX : (invoiceData.cgst > 0 && !hasStoneWeight) ? 59 * scaleX  : hasStoneWeight ? 46 * scaleX : 65 * scaleX
                    },

                    wastage: {
                        x:  (invoiceData.cgst>0 && hasStoneWeight) ? 433 * scaleX: 409 * scaleX,
                        width: (invoiceData.cgst>0 && hasStoneWeight) ? 43 * scaleX :  57 * scaleX
                    },

                    mc: {
                        x: hasStoneWeight ? 476 * scaleX: 467 * scaleX,
                        width:hasStoneWeight ? 50 * scaleX :  55 * scaleX
                    },
                    itemprice: {
                        x: hasStoneWeight ? 525 * scaleX : 523 * scaleX, 
                        width: hasStoneWeight ? 72 * scaleX : 71 * scaleX
                    }
                };

                // Wrap item name if needed
                const nameLines = wrapText(item.name, itemRow.item.width, 8 * scaleY);
                const lineHeight = 12 * scaleY;
                const totalHeight = nameLines.length * lineHeight;
                const startY = itemRow.y + (itemRow.height/2) - (totalHeight/2);
                
                itemsText += `
                    <!-- Full Row Background -->
                    <rect x="25" y="${itemRow.y}" width="${originalWidth-55}" height="${itemRow.height-70}"  
                    fill="rgba(0, 0, 0, 0)"/>


                    <rect x="${itemRow.item.x - 230}" y="${itemRow.y}" 
                        width="${itemRow.qty.width - 55}" height="${itemRow.height - 60}" 
                        fill="rgba(0, 0, 0, 0)" />

                    <text x="${itemRow.item.x - 230 + ((itemRow.qty.width - 55) / 2)}" 
                        y="${itemRow.y + ((itemRow.height - 60) / 2)}"
                        font-size="42" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" alignment-baseline="middle">
                        ${i + 1}
                    </text>

                    <!-- Item Name Column -->
                    <rect x="${itemRow.item.x - 50}" y="${itemRow.y}" 
                        width="${itemRow.item.width + 170}" height="${itemRow.height - 70}" 
                        fill="rgba(0, 0, 0, 0)" />

                    <text x="${itemRow.item.x - 50 + ((itemRow.item.width + 170) / 2)}" 
                        y="${itemRow.y + ((itemRow.height - 70) / 2)}"
                        font-size="42" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" alignment-baseline="middle">
                        ${item.name}
                        ${item.code ? `
                            <tspan x="${itemRow.item.x - 50 + ((itemRow.item.width + 170) / 2)}" 
                                dy="42" 
                                font-size="32" font-weight="500"
                                font-family="Roboto">
                                (${item.code})
                            </tspan>
                        ` : ''}
                    </text>

                    <!-- Quantity Column -->
                    <rect x="${itemRow.qty.x + 60}" y="${itemRow.y}" 
                        width="${itemRow.qty.width-30 }" height="${itemRow.height - 70}" 
                        fill="rgba(0, 0, 0, 0)" />

                    <text x="${itemRow.qty.x + 60 + ((itemRow.qty.width-30 ) / 2)}" 
                        y="${itemRow.y + ((itemRow.height - 70) / 2)}"
                        font-size="42" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" alignment-baseline="middle">
                        ${item.qty}
                    </text>

                    <!-- HSN Column -->
                   <!-- HSN Column -->
                    <rect x="${itemRow.hsn.x-20}" y="${itemRow.y}" 
                        width="${itemRow.hsn.width - 150}" height="${itemRow.height - 70}" 
                        fill="rgba(0, 0, 0, 0)" />

                    
                    ${invoiceData.cgst ? `
                        <text x="${itemRow.hsn.x-20 + ((itemRow.hsn.width - 150) / 2)}" 
                                y="${itemRow.y + ((itemRow.height - 70) / 2)}"
                                font-size="42" font-weight="500"
                                font-family="Roboto"
                                text-anchor="middle" alignment-baseline="middle">
                            ${item.hsn || '-'}
                        </text>` : ''}
                    <!-- Gross Weight Column -->
                    <rect x="${itemRow.grossWt.x}" y="${itemRow.y}" 
                        width="${itemRow.grossWt.width}" height="${itemRow.height - 70}" 
                        fill="rgba(0, 0, 0, 0)" />

                    <text x="${itemRow.grossWt.x + itemRow.grossWt.width / 2}" 
                        y="${itemRow.y + (itemRow.height - 70) / 2}" 
                        font-size="42" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" 
                        dominant-baseline="middle">
                        ${item.grosswt} grams
                    </text>

                    <!-- Net Weight Column -->
                    
                    <!-- Stone Weight Column -->
                    <rect x="${itemRow.stoneWt.x}" y="${itemRow.y}" 
                        width="${itemRow.stoneWt.width}" height="${itemRow.height - 70}" 
                        fill="rgba(0, 0, 0, 0)" />
                        
                    ${hasStoneWeight ? `<text x="${itemRow.stoneWt.x + itemRow.stoneWt.width / 2}" 
                        y="${itemRow.y + (itemRow.height - 70) / 2}" 
                       font-size="42" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" alignment-baseline="central">
                        ${item.stoneweight > 0 ? `${item.stoneweight} grams` : '----'}
                        ${item.stonerate>0 ? `
                            <tspan x="${itemRow.stoneWt.x + itemRow.stoneWt.width / 2}" 
                                dy="42" 
                                font-size="32" font-weight="500"
                                font-family="Roboto">
                                (Rs.${item.stonerate})
                            </tspan>
                        ` : ''}
                    </text>` : ''}
                    
                    <rect x="${itemRow.netWt.x}" y="${itemRow.y}" 
                        width="${itemRow.netWt.width}" height="${itemRow.height - 70}" 
                        fill="rgba(0, 0, 0, 0)" />
                        
                    <text x="${itemRow.netWt.x + itemRow.netWt.width / 2}" 
                        y="${itemRow.y + (itemRow.height - 70) / 2}" 
                        font-size="42" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" alignment-baseline="central">
                        ${item.netweight} grams
                    </text>

                    ${(invoiceData.cgst>0 && item.VA>0)?
                        `<text x="${itemRow.netWt.x + itemRow.netWt.width / 2}" 
                        y="${itemRow.y+40 + (itemRow.height - 70) / 2}" 
                        font-size="30" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" alignment-baseline="central">
                        ( V.A ${item.VA}% )
                        </text>`:''
                    }



                    <!-- Rate Column -->
                    <rect x="${itemRow.rate.x}" y="${itemRow.y}" 
                        width="${itemRow.rate.width}" height="${itemRow.height - 70}" 
                        fill="rgba(0, 0, 0, 0)" />
                        
                    <text x="${itemRow.rate.x + itemRow.rate.width / 2}" 
                        y="${itemRow.y + (itemRow.height - 70) / 2}" 
                        font-size="42" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" alignment-baseline="central">
                        RS. ${item.rate}
                    </text>


                     <!-- Wastage Column -->
                        <rect x="${itemRow.wastage.x}" 
                            y="${itemRow.y}" 
                            width="${itemRow.wastage.width}" 
                            height="${itemRow.height - 70}" 
                            fill="rgba(0, 0, 0, 0)" />

                        <text x="${itemRow.wastage.x + (itemRow.wastage.width / 2)}" 
                            y="${itemRow.y + ((itemRow.height - 70) / 2)}"
                            font-size="42" font-weight="500"
                            font-family="Roboto"
                            text-anchor="middle" 
                            dominant-baseline="middle">  <!-- Corrected vertical alignment -->
                             ${invoiceData.cgst > 0 ? `Rs. ${item.wastage*item.rate}` : item.wastage}
                        </text>


                    <!-- Making Charges Column -->
                    <rect x="${itemRow.mc.x}" 
                        y="${itemRow.y}" 
                        width="${itemRow.mc.width}" 
                        height="${itemRow.height - 70}" 
                        fill="rgba(0, 0, 0, 0)" />

                    <text x="${itemRow.mc.x + (itemRow.mc.width / 2)}" 
                        y="${itemRow.y + ((itemRow.height - 70) / 2)}"
                        font-size="42" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" 
                        alignment-baseline="central">
                        RS. ${item.mc}
                    </text>

                    <rect x="${itemRow.itemprice.x}" 
                        y="${itemRow.y}" 
                        width="${itemRow.itemprice.width}" 
                        height="${itemRow.height - 70}" 
                        fill="rgba(0, 0, 0, 0)" />

                    <text x="${itemRow.itemprice.x + (itemRow.itemprice.width / 2)}" 
                        y="${itemRow.y + ((itemRow.height - 70) / 2)}"
                        font-size="42" font-weight="500"
                        font-family="Roboto"
                        text-anchor="middle" alignment-baseline="central">
                        RS. ${item.itemprice}
                    </text>
                `;
                
                topPosition += 120;
            }
        }

        const [datePart, time] = invoiceData.time.split(" "); 
        const [year, month, day] = datePart.split("/");
        const formattedYear = year.slice(-2); 
        const formattedDate = `${day}/${month}/${formattedYear}`;
        
        let formattedText = Object.entries(invoiceData.paymethod)
            .map(([key, value]) => `${key}: Rs.${value}`)
            .map(text => `<tspan x="${invoiceData.cgst>0 ? dateSection.x - 1250 : dateSection.x - 1930}" dy="1.2em">${text}</tspan>`)
            .join("");


        let [hours, minutes] = time.split(":");
        hours = parseInt(hours);
        const ampm = hours >= 12 ? "PM" : "AM";
        hours = hours % 12 || 12; 

        const formattedTime = `${hours}:${minutes} ${ampm}`;
        const finalDateTime = `${formattedDate} ${formattedTime}`;

        const svgOverlay = `
            <svg width="${originalWidth}" height="${originalHeight}">
                <style>
                    text { 
                        font-family: Arial, sans-serif;
                        fill: black;
                        letter-spacing: 0.2px;
                    }
                </style>


                <!-- Customer Details -->
         
                <!-- Customer Section Text -->
                <text x="${customerSection.x + 380}" y="${customerSection.y+105}"
                    font-size="46" font-weight="500"
                    font-family="Roboto"
                    text-anchor="start" alignment-baseline="hanging">
                    ${invoiceData.cname}
                    <tspan x="${customerSection.x + 380}" dy="${13 * scaleY}">
                        ${invoiceData.cmobile}
                    </tspan>
                    ${invoiceData.caddress ? `
                        <tspan x="${customerSection.x + 380}" dy="${13 * scaleY}">
                            ${invoiceData.caddress}
                        </tspan>
                    ` : ''}
                </text>

                <!-- Date and Invoice -->
                <!-- Date Section Rectangle -->
                <!-- Date Section Rectangle -->
                    <!-- Date Section Rectangle -->
                   

                    <!-- Left-Aligned Date Section Text -->
                    <text x="${dateSection.x + 660}" 
                        y="${dateSection.y + 103}" 
                        font-size="46" font-weight="500"
                        font-family="Roboto"
                        text-anchor="start" alignment-baseline="hanging">
                        ${finalDateTime}
                        <tspan x="${dateSection.x + 660}" dy="${13 * scaleY}">
                            ${invoiceData.invoice}
                        </tspan>
                        <tspan x="${dateSection.x + 660}" dy="${13 * scaleY}">
                            ${Object.keys(invoiceData.paymethod).join(" / ")}
                        </tspan>
                    </text>

                <!-- Items Section -->
                ${itemsText}



                <!-- Total Line Background -->

                 <text x="${dateSection.x - 1415}" 
                    y="${dateSection.y + 1340}" 
                    font-size="52" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    
                    <tspan dy="0">
                        ${invoiceData.items.reduce((sum, item) => sum + item.qty, 0)}
                    </tspan>
                </text>



                <text x="${(invoiceData.cgst > 0 && hasStoneWeight) ? dateSection.x - 1070 : (invoiceData.cgst > 0 && !hasStoneWeight) ?  dateSection.x - 1060 : hasStoneWeight ?  dateSection.x - 1275 :  dateSection.x - 1220 }" 
                    y="${dateSection.y + 1340}" 
                    font-size="52" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    
                    <tspan dy="0">
                        ${invoiceData.items.reduce((sum, item) => sum + item.grosswt, 0)} grams
                    </tspan>
                </text>

                <text x="${(invoiceData.cgst > 0 && hasStoneWeight) ? dateSection.x - 460 : (invoiceData.cgst > 0 && !hasStoneWeight) ?  dateSection.x - 690 : hasStoneWeight ?  dateSection.x - 600 :  dateSection.x - 750 }" 
                    y="${dateSection.y + 1340}" 
                    font-size="52" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    
                    <tspan dy="0">
                        ${invoiceData.items.reduce((sum, item) => sum + item.netweight, 0)} grams
                    </tspan>
                </text>

                <text x="${dateSection.x + 730}" 
                    y="${dateSection.y + 1340}" 
                    font-size="52" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    
                    <tspan dy="0">
                        Rs.${invoiceData.items.reduce((sum, item) => sum + item.itemprice, 0)}
                    </tspan>
                </text>



                <!-- First Line Background -->



                <text x="${dateSection.x + 650}" 
                    y="${dateSection.y + 1468}" 
                    font-size="46" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    
                    <tspan dy="0">
                        Rs.${invoiceData.final}
                    </tspan>
                </text>

                ${invoiceData.roundoff>0 ? `<text x="${dateSection.x + 361}" 
                    y="${dateSection.y + 1530}" 
                    font-size="50" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    <tspan dy="0">
                     Round off : 
                    </tspan>
                </text>

                 <text x="${dateSection.x + 650}" 
                    y="${dateSection.y + 1530}" 
                    font-size="50" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    <tspan dy="0">
                     Rs.${invoiceData.roundoff}
                    </tspan>
                </text>`:''}


                ${invoiceData.discount>0 ? `<text x="${ dateSection.x + 382 }" 
                    y="${invoiceData.roundoff>0 ? dateSection.y + 1595 : dateSection.y + 1530}" 
                    font-size="50" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    <tspan dy="0">
                     Discount : 
                    </tspan>
                </text>

                <text x="${dateSection.x + 650}" 
                    y="${invoiceData.roundoff>0 ?dateSection.y + 1595:dateSection.y + 1530}" 
                    font-size="46" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    <tspan dy="0">
                        Rs.${invoiceData.discount}
                    </tspan>
                </text>` : ''}


                <text x="${dateSection.x - 315}" 
                    y="${dateSection.y + 1463}" 
                    font-size="46" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    
                    <tspan dy="0">
                        Rs.${invoiceData.cgst}
                    </tspan>
                </text>
                <text x="${dateSection.x - 315}" 
                    y="${dateSection.y + 1526}" 
                    font-size="46" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    <tspan dy="0">
                     Rs.${invoiceData.sgst}
                    </tspan>
                </text>
                <text x="${dateSection.x - 315}" 
                    y="${dateSection.y + 1591}" 
                    font-size="46" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    
                    <tspan dy="0">
                        Rs.${invoiceData.cgst + invoiceData.sgst}
                    </tspan>
                </text>


                <text x="${dateSection.x + 650}" 
                    y="${dateSection.y + 1753}" 
                    font-size="50" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    <tspan dy="0">
                        Rs.${invoiceData.sale_price}
                    </tspan>
                </text>
            

                <text x="${dateSection.x - 1630}" 
                    y="${invoiceData.cgst>0 ? dateSection.y + 1695  :dateSection.y + 1702}" 
                    font-size="50" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    ${formattedText}
                </text>





                
                <!-- The rest of your existing SVG content -->


                ${invoiceData.og_nw > 0 ? `<text x="${dateSection.x + 625}" 
                    y="${dateSection.y + 1690}" 
                    font-size="50" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="end" 
                    alignment-baseline="middle">
                    <tspan dy="0">
                        Purchased Gold ${invoiceData.og_nw} grams : 
                    </tspan>
                </text>
                <text x="${dateSection.x + 650}" 
                    y="${dateSection.y + 1690}" 
                    font-size="50" 
                    font-weight="500" 
                    font-family="Roboto" 
                    text-anchor="start" 
                    alignment-baseline="middle">
                    <tspan dy="0">
                        Rs.${invoiceData.og_price}
                    </tspan>
                </text>`:''}
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
// Modified printer listing function for Windows


// In your app.post('/print') route, replace only the printer command section with this:
app.post('/print', async (req, res) => {
    try {
        const invoiceData = req.body;
        
        if ((!invoiceData.item || !invoiceData.time) && (!invoiceData.items || !invoiceData.time)) {
            return res.status(400).json({ error: 'Missing required invoice data' });
        }

        const requestKey = JSON.stringify({
            time: invoiceData.time,
            total: invoiceData.total
        });

        // Check if this request has been processed recently
        if (recentPrintRequests.has(requestKey)) {
            const lastRequestTime = recentPrintRequests.get(requestKey);
            const timeSinceLastRequest = Date.now() - lastRequestTime;
            
            if (timeSinceLastRequest < 30000) { // 30 seconds in milliseconds
                return res.status(429).json({ 
                    error: 'Please wait 30sec before submitting the same print request again',
                    remainingTime: Math.ceil((30000 - timeSinceLastRequest) / 1000) // Remaining time in seconds
                });
            }
        }

        // Record this request time
        recentPrintRequests.set(requestKey, .now());
        
        // Clean up old entries from the Map periodically
        if (recentPrintRequests.size > 100) { // Arbitrary limit to prevent memory issues
            const now = Date.now();
            for (const [key, timestamp] of recentPrintRequests.entries()) {
                if (now - timestamp > 30000) {
                    recentPrintRequests.delete(key);
                }
            }
        }

        const tempDir = path.join(__dirname, 'temp');
        await fs.mkdir(tempDir, { recursive: true });

         const tempPDFPath = invoiceData.metal? === 'gold' 
                ? await generateGoldInvoicePDF(invoiceData) 
                : await generateInvoicePDF(invoiceData);
        

        const printerName = invoiceData.metal? === 'gold' ? '"EPSON L3250 Series"' : '"Samsung M2020 Series"'; 
        

        if (!printerName) {
            throw new Error('No printer found');
        }

        let printCommand;
        // Windows-specific print command
        if(invoiceData.metal === 'silver'){
                printCommand = `Start-Process -FilePath 'C:\\Program Files\\SumatraPDF\\SumatraPDF.exe' ` 
            + `-ArgumentList '-silent', '-print-to-default', '-print-settings', 'paper=A5,fit,print-as-image=no,autorotate=yes,center=yes,margin-left=0,margin-top=0,margin-right=0,margin-bottom=0', '${tempPDFPath}' `  
            + `-NoNewWindow -Wait`;
        }
        else{
            printCommand = `"C:\\Program Files\\SumatraPDF\\SumatraPDF.exe" -silent -print-to ${printerName} `
            +`-print-settings "paper=A5,fit,print-as-image=no, autorotate-yes, center-yes, res=600x600, quality=high" "${tempPDFPath}"`;
        }

        exec(`powershell -Command "${printCommand}"`, (error, stdout, stderr) => {
            if (error) {
                console.error(`Error: ${error.message}`);
                return;
            }
            if (stderr) {
                console.error(`stderr: ${stderr}`);
                return;
            }
            console.log(`stdout: ${stdout}`);
        });


        //to save the printed pdf

        // // Save a copy for quality verification (optional)
        // const debugPath = path.join(__dirname, 'debug', `invoice-${Date.now()}.png`);
        // await fs.mkdir(path.join(__dirname, 'debug'), { recursive: true });
        // await fs.copyFile(tempImagePath, debugPath);

        // await fs.unlink(tempImagePath);

        res.json({ 
            success: true, 
            message: `Invoice printed successfully to ${printerName}`,
        });
        
    } catch (error) {
        console.error('Error printing invoice:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.listen(5010, () => {
    console.log(`Print server running on port ${port}`);
    console.log(`Access the server at http://localhost:${port}`);
});


