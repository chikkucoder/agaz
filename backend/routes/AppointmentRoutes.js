const express = require('express');
const router = express.Router();
const Appointment = require('../schemas/AppointmentSchema');
const multer = require('multer');

// ✅ मेमोरी स्टोरेज सेटअप (फाइल फोल्डर में नहीं जाएगी)
const storage = multer.memoryStorage();
const upload = multer({ 
    storage: storage,
    limits: { fileSize: 5 * 1024 * 1024 } // 5MB Limit
});

// Route: Register & Upload to DB
router.post('/book', upload.single('healthCard'), async (req, res) => {
    try {
        const { 
            name, gender, age, aadhar, phone, bloodGroup, 
            healthId, street, city, pin, department, doctor, date, message 
        } = req.body;

        const newAppointment = new Appointment({
            name, gender, age, aadhar, phone, bloodGroup,
            healthId, street, city, pincode: pin,
            department, doctor, date, message
        });

        // ✅ फाइल को डेटाबेस बफर में डालना
        if (req.file) {
            newAppointment.healthCardData = req.file.buffer;
            newAppointment.healthCardContentType = req.file.mimetype;
            newAppointment.healthCardFileName = req.file.originalname;
        }

        await newAppointment.save();
        res.status(200).json({ success: true, message: "Registered Successfully in Database!" });

    } catch (error) {
        console.error("Booking Error:", error);
        res.status(500).json({ success: false, message: "Database Error: " + error.message });
    }
});

// Route: फाइल देखने के लिए (ID के ज़रिये डेटाबेस से फाइल निकालना)
router.get('/view-card/:id', async (req, res) => {
    try {
        const patient = await Appointment.findById(req.params.id);
        if (!patient || !patient.healthCardData) return res.status(404).send("No file found");

        res.set('Content-Type', patient.healthCardContentType);
        res.send(patient.healthCardData);
    } catch (e) { res.status(500).send(e.message); }
});

// ✅ Route: Get All Appointments (For Admin Dashboard)
router.get('/all', async (req, res) => {
    try {
        const appointments = await Appointment.find().sort({ createdAt: -1 });
        res.json({ success: true, data: appointments });
    } catch (error) {
        console.error("Fetch Appointments Error:", error);
        res.status(500).json({ success: false, message: "Error fetching appointments" });
    }
});

module.exports = router;