const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const Razorpay = require('razorpay');
const { Applicant, NormalApplicant } = require('../schemas/ApplicationSchema');
const PendingPayment = require('../models/PendingPayment');
const PaymentLog = require('../models/PaymentLog');
const crypto = require('crypto');

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ✅ FILE FILTER - Images and PDF (for CV/Resume)
const fileFilter = (req, file, cb) => {
    const extension = path.extname(file.originalname || '').toLowerCase();
    const allowedExts = new Set(['.jpeg', '.jpg', '.png', '.gif', '.pdf', '.heic', '.heif']);
    const allowedMimes = new Set([
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'application/pdf',
        'image/heic',
        'image/heif',
        'image/heic-sequence',
        'image/heif-sequence'
    ]);

    const mimeType = (file.mimetype || '').toLowerCase();
    const extAllowed = allowedExts.has(extension);
    const mimeAllowed = allowedMimes.has(mimeType);

    if (extAllowed && mimeAllowed) {
        return cb(null, true);
    }

    cb(new Error('Only image files (JPEG, JPG, PNG, GIF, HEIC, HEIF) and PDF are allowed!'));
};

// Multer Setup for Photo Upload
const storage = multer.diskStorage({
    destination: path.join(__dirname, '..', 'uploads'),
    filename: (_req, file, cb) => {
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, 'photo-' + Date.now() + '-' + sanitized);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max (larger for PDFs)
    fileFilter: fileFilter
});

const handlePhotoUpload = (req, res, next) => {
    upload.single('photo')(req, res, (err) => {
        if (!err) {
            return next();
        }

        if (err instanceof multer.MulterError) {
            return res.status(400).json({
                success: false,
                message: err.code === 'LIMIT_FILE_SIZE'
                    ? 'Photo size must be less than or equal to 5MB.'
                    : `Photo upload error: ${err.message}`
            });
        }

        return res.status(400).json({
            success: false,
            message: err.message || 'Photo upload failed.'
        });
    });
};

// ✅ PROFESSIONAL PDF GENERATOR (With Async/Await & Education Details)
function generatePDF(applicant, filename) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 30, size: 'A4' });
            const filePath = path.join(__dirname, 'uploads', filename);
            const stream = fs.createWriteStream(filePath);
            
            // ✅ FIX: PDF jab poori save ho jaye, tabhi aage badhe
            stream.on('finish', () => resolve(true));
            stream.on('error', (err) => reject(err));

            doc.pipe(stream);
            doc.fontSize(22).font('Helvetica-Bold').text('AAGAJ FOUNDATION', { align: 'center', underline: true });
            doc.fontSize(10).font('Helvetica').text('Registered Under Indian Trust Act 1882', { align: 'center' });
            doc.moveDown(0.5);
            doc.fontSize(16).text('EMPLOYEE APPLICATION FORM', { align: 'center' });
            doc.moveDown(1);

            if(applicant.photoPath) {
                try {
                    const relativePath = applicant.photoPath.startsWith('/') ? applicant.photoPath.substring(1) : applicant.photoPath;
                    const imagePath = path.join(__dirname, relativePath);
                    if(fs.existsSync(imagePath)) { doc.image(imagePath, 450, 100, { width: 100, height: 120 }); }
                } catch(e) { console.log("PDF Photo Error:", e.message); }
            }

            doc.fontSize(14).font('Helvetica-Bold').text('Personal Information', { underline: true });
            doc.moveDown(0.5);
            doc.fontSize(12).font('Helvetica');
            
            const startX = 30; let currentY = doc.y; const gap = 20;
            doc.text(`Application ID: AF-${applicant.uniqueId}`, startX, currentY); currentY += gap;
            doc.text(`Applied Post: ${applicant.roleApplied}`, startX, currentY); currentY += gap;
            doc.text(`Full Name: ${applicant.fullName}`, startX, currentY); currentY += gap;
            doc.text(`Mobile No: ${applicant.mobile}`, startX, currentY); currentY += gap;
            doc.text(`Email ID: ${applicant.email}`, startX, currentY); currentY += gap;
            doc.text(`Date of Birth: ${applicant.dob}`, startX, currentY); currentY += gap;
            doc.text(`District: ${applicant.district}`, startX, currentY); currentY += gap;
            doc.text(`State: ${applicant.state}`, startX, currentY); currentY += gap + 20;
            doc.text(`Aadhar No: ${applicant.aadhar || 'N/A'}`, startX, currentY);
            
            doc.y = currentY + gap;

            // ✅ NAYA HISSA: Education details print hongi
            doc.fontSize(14).font('Helvetica-Bold').text('Educational Qualifications', { underline: true });
            doc.moveDown(0.5);
            doc.fontSize(12).font('Helvetica');
            
            if (applicant.qualifications) {
                const q = applicant.qualifications;
                if (q.matric && q.matric.school) doc.text(`Matriculation: ${q.matric.school} | Board: ${q.matric.board} | Year: ${q.matric.year} | Marks: ${q.matric.marks}%`);
                if (q.inter && q.inter.school) doc.text(`Intermediate: ${q.inter.school} | Board: ${q.inter.board} | Year: ${q.inter.year} | Marks: ${q.inter.marks}%`);
                if (q.grad && q.grad.school) doc.text(`Graduation: ${q.grad.school} | Board: ${q.grad.board} | Year: ${q.grad.year} | Marks: ${q.grad.marks}%`);
            } else {
                doc.text("No education details provided.");
            }

            doc.moveDown(1.5);
            doc.fontSize(14).font('Helvetica-Bold').text('Payment Details & Declaration', { underline: true });
            doc.moveDown(0.5);
            doc.fontSize(12).font('Helvetica');
            
            doc.text(`Transaction ID: ${applicant.paymentId}`);
            doc.text(`Amount Paid: Rs. ${applicant.amount}`);
            doc.text(`Date of Application: ${applicant.date ? applicant.date.toDateString() : new Date().toDateString()}`);
            doc.moveDown(2);
            doc.fontSize(10).text("I hereby declare that the information provided above is true to the best of my knowledge.", { align: 'center' });
            
            doc.end();
        } catch (error) {
            reject(error);
        }
    });
}
// ✅ 1. CREATE ORDER - Store data temporarily, don't save to DB yet
router.post('/create-order', handlePhotoUpload, async (req, res) => {
    try {
        if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
            console.error("RAZORPAY configuration missing in .env file");
            return res.status(500).json({ success: false, message: "Payment gateway not configured. Please contact administrator." });
        }

        const { full_name, email, mobile, dob, district, state, role_applied, qualifications, amount, aadhar, job_category } = req.body;
        const orderId = "APP" + Date.now();
        let TargetModel = job_category === 'Normal' ? NormalApplicant : Applicant;
        
        // // ✅ BUG FIX: Safe Unique ID Generator
        // const lastApplicant = await TargetModel.findOne().sort({ _id: -1 });
        // let nextId = "0001";
        // if (lastApplicant && lastApplicant.uniqueId) { 
        //     const lastNum = parseInt(lastApplicant.uniqueId.replace(/\D/g, ''));
        //     if (!isNaN(lastNum)) {
        //         nextId = (lastNum + 1).toString().padStart(4, '0'); 
        //     }
        // }


        // ✅ BUG FIX: Category & Year-Wise Unique ID Generator (NGO-YY-XXXX or NOR-YY-XXXX)
        const currentYear = new Date().getFullYear().toString().slice(-2); // Gets "26" for 2026
        const idPrefix = job_category === 'Normal' ? 'NOR' : 'NGO'; // Prefix set karna
        
        // Find the last applicant created in the CURRENT year with this prefix
        const lastApplicant = await TargetModel.findOne({ 
            uniqueId: new RegExp(`^${idPrefix}-${currentYear}-`) 
        }).sort({ _id: -1 });

        let nextId = `${idPrefix}-${currentYear}-0001`; // Default: e.g. "NGO-26-0001" or "NOR-26-0001"

        if (lastApplicant && lastApplicant.uniqueId) { 
            // Split the ID (e.g., "NGO-26-0045" becomes ["NGO", "26", "0045"])
            const parts = lastApplicant.uniqueId.split('-');
            
            if (parts.length === 3 && parts[0] === idPrefix && parts[1] === currentYear) {
                const lastNum = parseInt(parts[2], 10);
                if (!isNaN(lastNum)) {
                    // Increment and pad with leading zeros to maintain 4 digits
                    nextId = `${idPrefix}-${currentYear}-${(lastNum + 1).toString().padStart(4, '0')}`; 
                }
            }
        }

        let qualParsed = {}; 
        try { qualParsed = qualifications ? JSON.parse(qualifications) : {}; } catch(e) { console.error("Parse error"); }

        // ✅ Create applicant object BUT DON'T SAVE to DB yet
        const newApplicant = new TargetModel({
            uniqueId: nextId, 
            orderId: orderId, 
            status: 'Pending',
            fullName: full_name, 
            email: email, 
            mobile: mobile, 
            dob: dob, 
            district: district, 
            state: state, 
            aadhar: aadhar, 
            roleApplied: role_applied,
            job_category: job_category || 'NGO',
            photoPath: req.file ? `/uploads/${req.file.filename}` : '',
            applicationPdf: `/uploads/APP_AF${nextId}_${Date.now()}.pdf`,
            qualifications: qualParsed,
            amount: amount ? parseInt(amount) : 499,
            emp_username: email 
        });
        
        // ⚠️ DON'T SAVE YET - Only save after payment success
        console.log("Application prepared (NOT saved to DB yet):", orderId);
        console.log("Applicant Data:", newApplicant);

        // ✅ Store applicant data in MongoDB (TTL 60 minutes)
        try {
            const appData = newApplicant.toObject ? newApplicant.toObject() : newApplicant;
            await PendingPayment.create({
                orderId: orderId,
                paymentType: 'application',
                data: appData
            });
            console.log("✅ Applicant stored in MongoDB pending collection");
        } catch (storeError) {
            console.error("❌ Error storing applicant in MongoDB:", storeError);
            return res.status(500).json({ success: false, message: "Failed to store payment data" });
        }

        const razorpayOrder = await razorpay.orders.create({
            amount: parseInt(newApplicant.amount, 10) * 100,
            currency: 'INR',
            receipt: orderId,
            notes: {
                paymentType: 'application',
                pendingOrderId: orderId,
                applicantName: full_name || '',
                applicantMobile: mobile || '',
                roleApplied: role_applied || ''
            }
        });

        return res.status(200).json({
            success: true,
            orderId: razorpayOrder.id,
            pendingOrderId: orderId,
            amount: razorpayOrder.amount,
            currency: razorpayOrder.currency,
            key: process.env.RAZORPAY_KEY_ID
        });

    } catch (error) {
        console.error("Create Order Error:", error);
        console.error("Error Stack:", error.stack);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ✅ 2. VERIFY RAZORPAY PAYMENT & SAVE DATA ONLY ON SUCCESS
router.post('/verify-payment', async (req, res) => {
    try {
        const {
            razorpay_order_id,
            razorpay_payment_id,
            razorpay_signature,
            pendingOrderId
        } = req.body;

        if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !pendingOrderId) {
            return res.status(400).json({ success: false, message: 'Missing payment verification fields' });
        }

        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');

        if (generatedSignature !== razorpay_signature) {
            return res.status(400).json({ success: false, message: 'Payment signature verification failed' });
        }

        const pendingRecord = await PendingPayment.findOne({
            orderId: pendingOrderId,
            paymentType: 'application'
        });

        if (!pendingRecord) {
            return res.status(404).json({ success: false, message: 'Pending application not found' });
        }

        const appData = pendingRecord.data;
        appData.status = 'Success';
        appData.paymentId = razorpay_payment_id;

        const pdfName = `APP_AF${appData.uniqueId}_${Date.now()}.pdf`;
        appData.applicationPdf = `/uploads/${pdfName}`;

        await generatePDF(appData, pdfName);

        const SaveModel = appData.job_category === 'Normal' ? NormalApplicant : Applicant;
        const newApplicant = new SaveModel(appData);
        await newApplicant.save();

        await PendingPayment.deleteOne({ orderId: pendingOrderId });

        try {
            await PaymentLog.create({
                orderId: pendingOrderId,
                amount: appData.amount,
                status: 'success',
                paymentId: razorpay_payment_id,
                transactionId: razorpay_order_id,
                schemeType: 'application',
                ipAddress: req.ip || req.connection.remoteAddress,
                userAgent: req.get('User-Agent'),
                rawResponse: req.body,
                verificationStatus: 'verified',
                amountVerified: true,
                signatureVerified: true
            });
        } catch (logError) {
            console.warn('PaymentLog write failed (application):', logError.message);
        }

        const redirectUrl = `/application.html?status=success&txn=${appData.paymentId}&name=${encodeURIComponent(appData.fullName)}&mobile=${appData.mobile}&email=${encodeURIComponent(appData.email)}&aadhar=${appData.aadhar}&unique_id=${appData.uniqueId}&dob=${appData.dob}&district=${encodeURIComponent(appData.district)}&state=${encodeURIComponent(appData.state)}&role=${encodeURIComponent(appData.roleApplied)}&amount=${appData.amount}&photo=${encodeURIComponent(appData.photoPath || '')}&pdf=${encodeURIComponent(appData.applicationPdf)}`;

        return res.json({ success: true, redirectUrl });
    } catch (error) {
        console.error("Verify Error:", error);
        return res.status(500).json({ success: false, message: 'Payment verification failed' });
    }
});

// ⚠️ COMMENTED OUT: Unused test routes (old API detection logic removed)
// router.get('/test-getepay', (req, res) => { ... });
// router.get('/health', (req, res) => { ... });

module.exports = router;