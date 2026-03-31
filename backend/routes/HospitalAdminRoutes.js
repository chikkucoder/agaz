const express = require('express');
const router = express.Router();
const HealthPartner = require('../schemas/SwasthyaSurkshaSchema');
const PatientBill = require('../schemas/PatientBillSchema');
const Appointment = require('../schemas/AppointmentSchema');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const HealthCard = require('../schemas/HealthCardSchema');

// ============================================
// ✅ MIDDLEWARE: VERIFY SUPER ADMIN
// ============================================
const verifyAdmin = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ success: false, message: "Access Denied" });
    try {
        const verified = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) { res.status(400).json({ success: false, message: "Invalid Token" }); }
};

// ============================================
// ✅ SUPER ADMIN ROUTES
// ============================================

// 1. Get Summary Stats for Super Admin
router.get('/admin/stats', verifyAdmin, async (req, res) => {
    try {
        const totalHospitals = await HealthPartner.countDocuments({ category: 'Hospital' });
        const activeHospitals = await HealthPartner.countDocuments({ category: 'Hospital', isActive: true });
        const totalBills = await PatientBill.aggregate([{ $group: { _id: null, total: { $sum: "$billAmount" } } }]);
        const totalTreatments = await PatientBill.countDocuments();
        const totalAppointments = await Appointment.countDocuments();

        res.json({
            success: true,
            stats: {
                totalHospitals,
                activeHospitals,
                totalBilling: totalBills[0] ? totalBills[0].total : 0,
                totalTreatments,
                totalAppointments
            }
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 2. Get All Hospitals with their stats
router.get('/admin/hospitals', verifyAdmin, async (req, res) => {
    try {
        const hospitals = await HealthPartner.find({ category: 'Hospital' }).lean();
        
        // Fetch billing and appointment stats for each hospital
        const hospitalData = await Promise.all(hospitals.map(async (h) => {
            const billStats = await PatientBill.aggregate([
                { $match: { hospitalId: h.uniqueId } },
                { $group: { _id: null, count: { $sum: 1 }, total: { $sum: "$billAmount" } } }
            ]);
            const apptCount = await Appointment.countDocuments({ hospitalId: h.uniqueId });

            return {
                ...h,
                treatmentCount: billStats[0] ? billStats[0].count : 0,
                totalBilling: billStats[0] ? billStats[0].total : 0,
                appointmentCount: apptCount,
                hasCredentials: !!h.password
            };
        }));

        res.json({ success: true, data: hospitalData });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 4. Global Reports: List ALL patient treatments and bills across ALL hospitals
router.get('/admin/global-reports', verifyAdmin, async (req, res) => {
    try {
        const bills = await PatientBill.find().sort({ date: -1 }).lean();
        
        // Link hospital names to bills for better reporting
        const detailedReports = await Promise.all(bills.map(async (b) => {
            const hospital = await HealthPartner.findOne({ uniqueId: b.hospitalId }).select('businessName');
            return {
                ...b,
                hospitalName: hospital ? hospital.businessName : 'Unknown Hospital'
            };
        }));

        res.json({ success: true, data: detailedReports });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 5. Generate/Update Credentials for a Hospital
router.post('/admin/generate-credentials', verifyAdmin, async (req, res) => {
    try {
        const { uniqueId, email, password } = req.body;
        if (!email || !password) return res.status(400).json({ success: false, message: "Email and Password are required" });

        const hashedPassword = await bcrypt.hash(password, 10);
        const updated = await HealthPartner.findOneAndUpdate(
            { uniqueId },
            { email: email.toLowerCase(), password: hashedPassword },
            { new: true }
        );

        if (!updated) return res.status(404).json({ success: false, message: "Hospital not found" });
        res.json({ success: true, message: "Credentials generated successfully" });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 6. Admin Register New Hospital (Full Control)
router.post('/admin/register-hospital', verifyAdmin, async (req, res) => {
    try {
        const { biz, hashPass, license, city, state, pin, owner, phone, email } = req.body;
        
        // --- 🩺 Robust Validation ---
        if (!biz || !license || !owner || !phone || !city || !state || !pin || !email || !hashPass) {
            return res.status(400).json({ success: false, message: "All fields are required!" });
        }

        // Name validation (No numbers)
        if (!/^[a-zA-Z\s]+$/.test(owner)) {
            return res.status(400).json({ success: false, message: "Owner name should only contain letters!" });
        }

        // City/State validation (No numbers)
        if (!/^[a-zA-Z\s]+$/.test(city) || !/^[a-zA-Z\s]+$/.test(state)) {
            return res.status(400).json({ success: false, message: "City and State should only contain letters!" });
        }

        // WhatsApp number validation (10 digits)
        if (!/^\d{10}$/.test(phone)) {
            return res.status(400).json({ success: false, message: "WhatsApp number must be exactly 10 digits!" });
        }

        // Pincode validation (6 digits)
        if (!/^\d{6}$/.test(pin)) {
            return res.status(400).json({ success: false, message: "Pincode must be exactly 6 digits!" });
        }

        // Email validation
        if (!/^\S+@\S+\.\S+$/.test(email)) {
            return res.status(400).json({ success: false, message: "Invalid email format!" });
        }

        // Check for duplicate license
        const existingLicense = await HealthPartner.findOne({ licenseNumber: license });
        if (existingLicense) return res.status(400).json({ success: false, message: "Hospital with this license already exists!" });

        // Check for duplicate email
        const existingEmail = await HealthPartner.findOne({ email: email.toLowerCase() });
        if (existingEmail) return res.status(400).json({ success: false, message: "This email is already in use by another hospital!" });

        // 1. Generate Unique ID (Format: 100026 -> Counter + YearSuffix)
        const date = new Date();
        const yearSuffix = date.getFullYear().toString().slice(-2);
        
        const lastPartner = await HealthPartner.findOne({ 
            uniqueId: { $regex: `${yearSuffix}$` } 
        }).sort({ _id: -1 });

        let counter = 1000;
        if (lastPartner && lastPartner.uniqueId) {
            const lastCounterStr = lastPartner.uniqueId.slice(0, -2);
            const lastCounter = parseInt(lastCounterStr);
            if (!isNaN(lastCounter)) counter = lastCounter + 1;
        }
        const newUniqueId = `${counter}${yearSuffix}`;

        // 2. Hash Password
        const hashedPassword = await bcrypt.hash(hashPass, 10);

        // 3. Create New Record
        const newHospital = new HealthPartner({
            uniqueId: newUniqueId,
            category: 'Hospital',
            businessName: biz,
            licenseNumber: license,
            address: { city, state, pincode: pin, fullAddress: `${city}, ${state}` },
            contact: { ownerName: owner, whatsappNumber: phone },
            email: email.toLowerCase(),
            password: hashedPassword,
            isActive: true,
            registeredBy: 'Master Admin'
        });

        await newHospital.save();
        res.status(201).json({ success: true, message: "Hospital Registered Successfully!", data: newHospital });

    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 7. Toggle Hospital Active Status
router.patch('/admin/toggle-status/:uniqueId', verifyAdmin, async (req, res) => {
    try {
        const hospital = await HealthPartner.findOne({ uniqueId: req.params.uniqueId });
        if (!hospital) return res.status(404).json({ success: false, message: "Hospital not found" });
        
        hospital.isActive = !hospital.isActive;
        await hospital.save();
        res.json({ success: true, message: `Hospital is now ${hospital.isActive?'Active':'Disabled'}`, isActive: hospital.isActive });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// ============================================
// ✅ HOSPITAL PARTNER ROUTES
// ============================================

// 1. Hospital Login
router.post('/hospital/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const hospital = await HealthPartner.findOne({ email: email.toLowerCase(), category: 'Hospital' });

        if (!hospital || !hospital.password) {
            return res.status(401).json({ success: false, message: "Invalid Credentials" });
        }

        const isMatch = await bcrypt.compare(password, hospital.password);
        if (!isMatch) return res.status(401).json({ success: false, message: "Invalid Credentials" });

        const token = jwt.sign({ id: hospital._id, uniqueId: hospital.uniqueId, role: 'hospital' }, process.env.JWT_SECRET, { expiresIn: '1d' });
        
        res.json({ 
            success: true, 
            token, 
            hospital: { 
                name: hospital.businessName, 
                uniqueId: hospital.uniqueId,
                email: hospital.email
            } 
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 2. Fetch Bills for a Hospital
router.get('/hospital/bills', async (req, res) => {
    try {
        const { hospitalId } = req.query;
        const bills = await PatientBill.find({ hospitalId }).sort({ date: -1 });
        res.json({ success: true, data: bills });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 3. Add/Update Patient Bill
router.post('/hospital/add-bill', async (req, res) => {
    try {
        const { hospitalId, healthId, patientName, patientMobile, treatmentDetails, billAmount, status, billPhoto } = req.body;
        
        const billId = 'BILL-' + Date.now();
        const newBill = new PatientBill({
            billId, hospitalId, healthId, patientName, patientMobile, treatmentDetails, billAmount, status, billPhoto
        });

        await newBill.save();
        res.json({ success: true, message: "Bill added successfully", data: newBill });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 4. Verify Patient (Fetch Name & Mobile from Health Card ID)
router.get('/hospital/verify-patient/:healthId', async (req, res) => {
    try {
        const patient = await HealthCard.findOne({ healthId: req.params.healthId });
        if (!patient) return res.status(404).json({ success: false, message: "Patient not found. Re-check Health ID." });
        
        res.json({ 
            success: true, 
            data: { 
                name: patient.fullName, 
                mobile: patient.mobile 
            } 
        });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

// 4. Fetch Appointments for a Hospital
router.get('/hospital/appointments', async (req, res) => {
    try {
        const { hospitalId } = req.query;
        const appointments = await Appointment.find({ hospitalId }).sort({ date: -1 });
        res.json({ success: true, data: appointments });
    } catch (error) { res.status(500).json({ success: false, message: error.message }); }
});

module.exports = router;
