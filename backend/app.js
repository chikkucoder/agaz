

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') }); // ✅ Fix: Explicit path to .env
const express = require('express');
const mongoose = require('mongoose');
// const Razorpay = require('razorpay');
const crypto = require('crypto');
const multer = require('multer');
const cors = require('cors');
const fs = require('fs');
const PDFDocument = require('pdfkit'); 
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');

// ✅ SECURITY IMPORTS
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { validate } = require('./validators/validators');
const PaymentLog = require('./models/PaymentLog');
const { createAuditTrailMiddleware } = require('./middlewares/auditTrail');


const PORT = process.env.PORT || 5000;

const app = express();
app.disable('x-powered-by');
app.set('etag', false);

// ============================================
// ✅ RATE LIMITING CONFIGURATION
// ============================================
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // 100 requests per 15 minutes
    message: { 
        success: false, 
        message: 'Too many requests from this IP, please try again after 15 minutes.' 
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => req.path === '/health' // Don't rate limit health check
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // Only 5 failed login attempts
    skipSuccessfulRequests: true, // Don't count successful logins
    message: { 
        success: false, 
        message: 'Too many failed login attempts. Account locked for 15 minutes.' 
    }
});

const paymentLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10, // 10 payment attempts per hour per IP
    message: { 
        success: false, 
        message: 'Payment limit exceeded. Please try again later.' 
    }
});

// --- Middleware ---
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true, limit: '5mb' }));

app.use(createAuditTrailMiddleware({
    excludePaths: ['/health', '/appointment/test-notify']
}));

app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/appointment') || req.path.startsWith('/swasthya') || req.path.startsWith('/schemes') || req.path.startsWith('/swarojgaar') || req.path.startsWith('/application') || req.path.startsWith('/donation')) {
        res.setHeader('Cache-Control', 'no-store');
        res.setHeader('Pragma', 'no-cache');
    }
    next();
});

// ✅ SECURITY MIDDLEWARE (MUST BE FIRST)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://cdn.jsdelivr.net", "https://cdnjs.cloudflare.com", "https://checkout.razorpay.com", "https://cdn.razorpay.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "blob:", "https:", "http:"],
            connectSrc: ["'self'", "https://cdn.jsdelivr.net", "https://api.razorpay.com", "https://checkout.razorpay.com", "https://cdn.razorpay.com", "https://api.postalpincode.in", "https://aagajfoundation.com", "https://www.aagajfoundation.com"],
            frameSrc: ["'self'", "https://api.razorpay.com", "https://checkout.razorpay.com"],
            formAction: ["'self'"],
            mediaSrc: ["'self'", "blob:"]
        }
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: { policy: "cross-origin" }
}));

// ✅ CORS CONFIGURATION (RESTRICTED)
const allowedOrigins = [
    "https://aagajfoundation.com",
    "https://www.aagajfoundation.com",
    "http://localhost:5000"
];

app.use(cors({
    origin: function(origin, callback) {
        if (!origin) return callback(null, true);

        if (allowedOrigins.includes(origin)) {
            callback(null, true);
        } else {
            console.warn("❌ CORS BLOCKED:", origin);
            callback(new Error("CORS policy: Access denied"));
        }
    },
    credentials: true
}));

// ✅ Safe OPTIONS handler
app.use((req, res, next) => {
    if (req.method === 'OPTIONS') {
        return res.sendStatus(200);
    }
    next();
});
// ✅ APPLY RATE LIMITING
app.use('/api/', apiLimiter);
app.use('/schemes/create-order', paymentLimiter);
app.use('/swarojgaar/create-order', paymentLimiter);
app.use('/api/healthcard/create-order', paymentLimiter);
app.use('/application/create-order', paymentLimiter);
app.use('/donation/create-donation-order', paymentLimiter);

app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); 


// 👆👆👆 यह लाइन HTML फाइल्स (card.html, form.html) को लोड करने के लिए जरूरी है


mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
      console.log("✅ MongoDB Connected");
      
      // ✅ Seed Test Hospital if it doesn't exist
      try {
          const HealthPartner = require('./schemas/SwasthyaSurkshaSchema');
          const bcrypt = require('bcryptjs');
          const testEmail = process.env.TEST_HOSPITAL_EMAIL;
          if (testEmail) {
              const existingHosp = await HealthPartner.findOne({ email: testEmail });
              if (!existingHosp) {
                  const hashedPassword = await bcrypt.hash(process.env.TEST_HOSPITAL_PASS || 'Aagaj@123', 10);
                  const newHosp = new HealthPartner({
                      uniqueId: "HOSP-TEST-01",
                      category: "Hospital",
                      businessName: "Test Foundation Hospital",
                      email: testEmail,
                      password: hashedPassword,
                      licenseNumber: "TEST-LIC-001",
                      address: {
                          fullAddress: "Main Street, Patna",
                          city: "Patna",
                          state: "Bihar",
                          pincode: "800001"
                      },
                      contact: {
                          ownerName: "Vivek Kumar",
                          whatsappNumber: "9431430464"
                      },
                      isActive: true
                  });
                  await newHosp.save();
                  console.log("🏥 Test Hospital Seeded: " + testEmail);
              }
          }
      } catch (err) { console.error("Seeding Error:", err); }
  })
  .catch(err => console.log("❌ DB Error:", err));


// --- Import Schema & Models ---
const { Applicant, NormalApplicant } = require('./schemas/ApplicationSchema');
const Employee = require('./schemas/AddNewEmployeeSchema'); // ✅ Import New Employee Schema
const Beneficiary = require('./schemas/SilayiPrasikshanSchema'); // ✅ Import Correct Scheme Schema
const SwarojgaarGroup = require('./schemas/SwarojgaarRegisterSchema'); // ✅ Import Swarojgaar Schema
const HealthPartner = require('./schemas/SwasthyaSurkshaSchema'); // ✅ Import Swasthya Surksha Schema
// const donationRoutes = require('./schemas/DonationSchema'); // ✅ Import Route

// --- Multer Setup ---
if (!fs.existsSync('./uploads')){
    fs.mkdirSync('./uploads');
}

// ✅ FILE FILTER FUNCTION
const fileFilter = (req, file, cb) => {
    const allowedTypes = /jpeg|jpg|png|gif/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (extname && mimetype) {
        return cb(null, true);
    } else {
        cb(new Error('Only image files (JPEG, JPG, PNG, GIF) are allowed!'));
    }
};

const storage = multer.diskStorage({
    destination: './uploads/',
    filename: (req, file, cb) => {
        const sanitized = file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        cb(null, 'photo-' + Date.now() + '-' + sanitized);
    }
});
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB max
    fileFilter: fileFilter
});

if (!fs.existsSync('./uploads/healthcards')){
    fs.mkdirSync('./uploads/healthcards', { recursive: true });
}


// ============================================
//      ✅ PROFESSIONAL PDF GENERATOR
// ============================================

// ============================================
//      ✅ JWT AUTHENTICATION MIDDLEWARE
// ============================================
const verifyAdmin = (req, res, next) => {
    const token = req.header('Authorization');
    if (!token) return res.status(401).json({ success: false, message: "Access Denied. No Token Provided." });

    try {
        const verified = jwt.verify(token.replace("Bearer ", ""), process.env.JWT_SECRET);
        req.user = verified;
        next();
    } catch (err) {
        res.status(400).json({ success: false, message: "Invalid Token" });
    }
};

// ============================================
//               API ROUTES
// ============================================

// 1. Create Order


// 2. Submit Application (Generates PDF)



// 3. Get All Applicants
app.get('/admin/get-all-applicants', verifyAdmin, async (req, res) => {
    try {
        // ✅ Fetch from BOTH collections
        const ngoApplicants = await Applicant.find().sort({ date: -1 }).lean();
        const normalApplicants = await NormalApplicant.find().sort({ date: -1 }).lean();
        const employees = await Employee.find().sort({ createdAt: -1 }).lean(); // ✅ Fetch Employees

        // Tag them so frontend knows which is which (if not already saved)
        const ngoTagged = ngoApplicants.map(a => ({ ...a, job_category: 'NGO' }));
        const normalTagged = normalApplicants.map(a => ({ ...a, job_category: 'Normal' }));

        // ✅ Map Employees to match Applicant structure for frontend
        const employeeTagged = employees.map(e => ({
            _id: e._id,
            uniqueId: e.empId.replace(/^EMP/, ''), // Map empId -> uniqueId (Remove EMP prefix)
            fullName: e.fullName,
            email: e.email,
            mobile: e.mobile,
            roleApplied: e.designation, // Map designation -> roleApplied
            district: e.district,
            state: e.state,
            job_category: 'Employee', // Tag as Employee
            emp_username: e.email,
            emp_password: 'Protected', // Password is hashed, cannot show
            photoPath: '', 
            applicationPdf: ''
        }));

        res.json([...ngoTagged, ...normalTagged, ...employeeTagged]);
    } catch (error) { 
        console.error("Fetch Error:", error);
        res.status(500).json({ message: "Error fetching data" }); 
    }
});

// ✅ 3.1 Get All Scheme Beneficiaries (Silai, Swarojgaar, Swasthya)
app.get('/admin/get-all-beneficiaries', verifyAdmin, async (req, res) => {
    try {
        // 1. Silai Data
        const silai = await Beneficiary.find().sort({ createdAt: -1 }).lean();
        const silaiTagged = silai.map(s => ({ 
            ...s, 
            yojanaName: 'Mahila Silai Prasikshan Yojana' 
        }));

        // 2. Swarojgaar Data
        const swarojgaar = await SwarojgaarGroup.find().sort({ createdAt: -1 }).lean();
        const swarojgaarTagged = swarojgaar.map(s => ({ 
            ...s, 
            yojanaName: 'Mahila Swarojgaar Yojana',
            name: s.groupName || "Unknown Group",
            guardianName: "Group Entry",
            address: `${s.village || ''}, ${s.panchayat || ''}, ${s.district || ''}`,
            mobileNumber: (Array.isArray(s.members) && s.members[0] && s.members[0].mobileNumber)
                ? s.members[0].mobileNumber
                : "N/A",
            aadharNumber: "N/A"
        }));

        // 3. Swasthya Data
        const health = await HealthPartner.find().sort({ createdAt: -1 }).lean();
        const healthTagged = health.map(s => ({ 
            ...s, 
            yojanaName: 'Swasthya Suraksha Yojana',
            // name: s.biz || s.owner || "Unknown",
            // guardianName: s.owner || "N/A",
            // address: `${s.addr || ''}, ${s.city || ''}`,
            // mobileNumber: s.phone || "N/A",
            // aadharNumber: s.license || "License No."

            type: s.category,
            biz: s.businessName,
            name: s.businessName,
            owner: s.contact ? s.contact.ownerName : "N/A",
            guardianName: s.contact ? s.contact.ownerName : "N/A",
    
            phone: s.contact ? s.contact.whatsappNumber : "N/A", 
            mobileNumber: s.contact ? s.contact.whatsappNumber : "N/A",

            addr: s.address ? s.address.fullAddress : "", 
            address: s.address ? `${s.address.fullAddress}, ${s.address.city}` : "",
    
            city: s.address ? s.address.city : (s.city || ""),
            state: s.address ? s.address.state : (s.state || ""),
            pin: s.address ? s.address.pincode : (s.pin || ""),
    
            license: s.licenseNumber, 
            aadharNumber: s.licenseNumber,

            // Category ke hisab se Extra Info dikhane ke liye
            extraInfo: s.numberOfBeds || s.nablStatus || s.drugLicenseExpiry || "-",

            services: s.services || [],

            createdAt: s.registrationDate || new Date()

        }));

        // Combine all
        const allBeneficiaries = [...silaiTagged, ...swarojgaarTagged, ...healthTagged];
        
        res.json(allBeneficiaries);
    } catch (error) {
        console.error("Fetch Beneficiaries Error:", error);
        res.status(500).json({ message: "Error fetching scheme data" });
    }
});

// ✅ 3.2 Get Employee Performance Stats (Aggregation)
app.get('/admin/employee-detailed-stats', verifyAdmin, async (req, res) => {
    try {
        const [silayiRows, swarojgaarRows, healthRows] = await Promise.all([
            Beneficiary.find({}).select('serialNumber name registeredBy').lean(),
            SwarojgaarGroup.find({}).select('groupName members registeredBy').lean(),
            HealthPartner.find({}).select('uniqueId businessName registeredBy').lean()
        ]);

        // Merge all details into a single object per employee
        const finalStats = {};

        const getEmployeeKey = (registeredBy) => {
            const value = (registeredBy || '').toString().trim();
            return value || 'Admin/Self';
        };

        const ensureEmployee = (email) => {
            if (!finalStats[email]) {
                finalStats[email] = {
                    email,
                    silayi: { count: 0, details: [] },
                    swarojgaar: { count: 0, details: [] },
                    health: { count: 0, details: [] },
                    total: 0
                };
            }
            return finalStats[email];
        };

        silayiRows.forEach((row) => {
            const email = getEmployeeKey(row.registeredBy);
            const employee = ensureEmployee(email);
            employee.silayi.count += 1;
            employee.silayi.details.push({
                serialNumber: row.serialNumber || 'N/A',
                name: row.name || 'N/A'
            });
        });

        swarojgaarRows.forEach((row) => {
            const email = getEmployeeKey(row.registeredBy);
            const employee = ensureEmployee(email);
            employee.swarojgaar.count += 1;
            employee.swarojgaar.details.push({
                groupName: row.groupName || 'N/A',
                memberCount: Array.isArray(row.members) ? row.members.length : 0
            });
        });

        healthRows.forEach((row) => {
            const email = getEmployeeKey(row.registeredBy);
            const employee = ensureEmployee(email);
            employee.health.count += 1;
            employee.health.details.push({
                uniqueId: row.uniqueId || 'N/A',
                businessName: row.businessName || 'N/A'
            });
        });

        Object.values(finalStats).forEach((employee) => {
            employee.total = employee.silayi.count + employee.swarojgaar.count + employee.health.count;
        });

        // Convert object to array and sort by total registrations (highest first)
        const report = Object.values(finalStats).sort((a, b) => b.total - a.total);

        res.json(report);
    } catch (error) {
        console.error("Stats Error:", error);
        res.status(500).json({ message: "Error generating report" });
    }
});

// 4. Delete Employee
app.delete('/admin/delete-employee/:id', verifyAdmin, async (req, res) => {
    try {
        // Try finding in NGO first, then Normal
        let user = await Applicant.findById(req.params.id);
        let Model = Applicant;

        if (!user) {
            user = await NormalApplicant.findById(req.params.id);
            Model = NormalApplicant;
        }
        
        // ✅ ADDED: Check Employee Collection
        if (!user) {
            user = await Employee.findById(req.params.id);
            Model = Employee;
        }

        if(!user) return res.json({ success: false, message: "Not found" });

        // Clean paths (remove leading slash if present)
        if(user.photoPath) {
            const p = path.join(__dirname, user.photoPath.startsWith('/') ? user.photoPath.substring(1) : user.photoPath);
            if(fs.existsSync(p)) fs.unlinkSync(p);
        }
        if(user.applicationPdf) {
            const p = path.join(__dirname, user.applicationPdf.startsWith('/') ? user.applicationPdf.substring(1) : user.applicationPdf);
            if(fs.existsSync(p)) fs.unlinkSync(p);
        }

        await Model.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) { res.status(500).json({ success: false }); }
});

//healthcard
// app.js mein routes ke paas ye add karein
app.get('/api/healthcard/all', async (req, res) => {
    try {
        const HealthCard = require('./schemas/HealthCardSchema');
        const cards = await HealthCard.find().sort({ createdAt: -1 });
        res.json({ success: true, data: cards });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});
//healthcard

// ✅ Connect New Employee Route
app.use('/admin', verifyAdmin, require('./routes/AddNewEmployeeRoutes'));

// ✅ Connect Silai/Swarojgaar/Swasthya Routes
app.use('/schemes', require('./routes/SilayiPrasikshanRoutes'));

// ✅ Connect Mahila Swarojgaar Yojana Routes
app.use('/swarojgaar', require('./routes/SwarojgaarRegisterRoutes'));

// ✅ Connect Swasthya Surksha Yojana Routes
app.use('/swasthya', require('./routes/SwasthyaSurkshaRoutes'));

// ✅ Connect Appointment Routes
app.use('/appointment', require('./routes/AppointmentRoutes'));

// ✅ Connect Application Routes (Forms)
app.use('/application', require('./routes/ApplicationRoutes'));

// ✅ DONATION ENDPOINT TEST & HEALTH CHECK
app.get('/donation/health', (req, res) => {
    res.json({ 
        status: 'healthy', 
        timestamp: new Date().toISOString(),
        message: 'Backend is running perfectly'
    });
});

app.post('/donation/test-payment', (req, res) => {
    const testData = {
        success: true,
        status: 'test_mode',
        paymentUrl: process.env.GETEPAY_URL || "https://pay1.getepay.in:8443/getepayPortal/pg/generateInvoice",
        mid: process.env.GETEPAY_MID || "108",
        encryptedData: "TEST_ENCRYPTED_DATA_" + Date.now(),
        message: "This is test data - check your .env file for GETEPAY_URL"
    };
    res.json(testData);
});

const donationRoutes = require('./routes/DonationRoutes'); // ✅ Import Route
app.use('/donation',donationRoutes); 
// 👆👆👆******************************** Isse /donation/create-donation-order active ho jayega

//Admin Register Routes
app.use('/admin-register', require('./routes/AdminRegisterRoutes'));

// ✅ Hospital Admin & Billing Routes
const HospitalAdminRoutes = require('./routes/HospitalAdminRoutes');
app.use('/api/hospital-admin-system', HospitalAdminRoutes);

// Routes Import
const healthCardRoutes = require('./routes/HealthCardRoutes'); 

// Routes Use
app.use('/api/healthcard', healthCardRoutes);


// 6. Login
app.post('/employee/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;
        
        // 1. Check in NGO Applicants
        let user = await Applicant.findOne({ $or: [{ email: username }, { emp_username: username }] });

        // 2. If not found, Check in Normal Applicants
        if (!user) {
            user = await NormalApplicant.findOne({ $or: [{ email: username }, { emp_username: username }] });
        }
        
        // 3. If not found, check in Employees collection (for admin-added users)
        if (!user) {
            user = await Employee.findOne({ email: username });
        }

        if (!user || (!user.emp_password && !user.password)) {
            return res.json({ success: false, message: "Invalid Credentials" });
        }

        // Use emp_password for applicants and password for employees
        const passwordToCompare = user.emp_password || user.password;

        const isMatch = await bcrypt.compare(password, passwordToCompare);
        
        if (isMatch) res.json({ success: true, user: user });
        else res.json({ success: false, message: "Invalid Credentials" });

    } catch (error) { console.error("Login Error:", error); res.status(500).json({ success: false, message: "Server error during login." }); }
});

// ✅ STATIC SHOULD BE LAST (IMPORTANT)
app.use(express.static(path.join(__dirname, "../frontend")));
app.use('/public', express.static(path.join(__dirname, "../frontend/public")));

app.use((req, res, next) => {
    if (req.path.startsWith('/api/') || req.path.startsWith('/appointment') || req.path.startsWith('/swasthya') || req.path.startsWith('/schemes') || req.path.startsWith('/swarojgaar') || req.path.startsWith('/application') || req.path.startsWith('/donation')) {
        return res.status(404).json({ success: false, message: 'Route not found' });
    }
    return next();
});

// ✅ Global Error Handler (Prevents Multer/Server Crashes)
app.use((err, req, res, next) => {
    console.error("🔥 Unhandled Error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
});

// app.listen(5000, () => console.log("🚀 Server running on port 5000"));
app.listen(PORT, () => {
    console.log(`🚀 Server running on port ${PORT}`);
});