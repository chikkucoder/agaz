const { Joi } = require('../middlewares/requestValidation');

const hospitalLoginSchema = Joi.object({
    identifier: Joi.string().trim().min(3).optional(),
    email: Joi.string().trim().email().optional(),
    password: Joi.string().min(6).required()
}).or('identifier', 'email');

const generateCredentialsSchema = Joi.object({
    uniqueId: Joi.string().trim().required(),
    email: Joi.string().email().required(),
    password: Joi.string().min(6).required(),
    loginId: Joi.string().trim().optional()
});

const registerHospitalSchema = Joi.object({
    biz: Joi.string().trim().min(2).max(150).required(),
    hashPass: Joi.string().min(6).required(),
    license: Joi.string().trim().min(3).max(80).required(),
    city: Joi.string().trim().min(2).max(80).required(),
    state: Joi.string().trim().min(2).max(80).required(),
    pin: Joi.string().pattern(/^\d{6}$/).required(),
    owner: Joi.string().trim().min(2).max(100).required(),
    phone: Joi.string().pattern(/^\d{10}$/).required(),
    email: Joi.string().email().required(),
    specialization: Joi.alternatives().try(
        Joi.string().trim().min(2).max(100),
        Joi.array().items(Joi.string().trim().min(2).max(100))
    ).optional()
});

const editHospitalSchema = Joi.object({
    biz: Joi.string().trim().min(2).max(150).required(),
    license: Joi.string().trim().min(3).max(80).required(),
    city: Joi.string().trim().min(2).max(80).required(),
    state: Joi.string().trim().min(2).max(80).required(),
    pin: Joi.string().pattern(/^\d{6}$/).required(),
    owner: Joi.string().trim().min(2).max(100).required(),
    phone: Joi.string().pattern(/^\d{10}$/).required(),
    email: Joi.string().email().required(),
    specialization: Joi.alternatives().try(
        Joi.string().trim().min(2).max(100),
        Joi.array().items(Joi.string().trim().min(2).max(100))
    ).optional()
});

const hospitalIdQuerySchema = Joi.object({
    hospitalId: Joi.string().trim().required()
});

const addBillSchema = Joi.object({
    hospitalId: Joi.string().trim().required(),
    healthId: Joi.string().trim().allow('', null).optional(),
    patientName: Joi.string().trim().min(2).max(100).required(),
    patientMobile: Joi.string().pattern(/^\d{10}$/).required(),
    treatmentDetails: Joi.string().trim().min(2).max(1000).required(),
    billAmount: Joi.number().positive().required(),
    status: Joi.string().valid('Paid', 'Unpaid').required(),
    billPhoto: Joi.string().allow('', null).optional()
});

const appointmentBookSchema = Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    gender: Joi.string().trim().allow('', null).optional(),
    age: Joi.alternatives().try(Joi.number().integer().min(0), Joi.string().trim().allow('')).optional(),
    aadhar: Joi.string().pattern(/^\d{12}$/).required(),
    phone: Joi.string().pattern(/^\d{10}$/).required(),
    bloodGroup: Joi.string().trim().allow('', null).optional(),
    healthId: Joi.string().trim().min(6).max(20).required(),
    street: Joi.string().trim().allow('', null).optional(),
    city: Joi.string().trim().allow('', null).optional(),
    pin: Joi.string().pattern(/^\d{6}$/).allow('', null).optional(),
    department: Joi.string().trim().allow('', null).optional(),
    doctor: Joi.string().trim().allow('', null).optional(),
    date: Joi.string().trim().required(),
    message: Joi.string().trim().allow('', null).optional(),
    hospitalId: Joi.string().trim().required()
});

const testNotifySchema = Joi.object({
    phone: Joi.string().pattern(/^\d{10,15}$/).required(),
    message: Joi.string().trim().max(500).optional(),
    sendSms: Joi.boolean().optional(),
    sendWhatsapp: Joi.boolean().optional()
});

const healthCardCheckExistsSchema = Joi.object({
    mobile: Joi.string().pattern(/^\d{10}$/).optional(),
    aadhar: Joi.string().pattern(/^\d{12}$/).optional()
}).or('mobile', 'aadhar');

const healthCardCreateOrderSchema = Joi.object({
    fullName: Joi.string().trim().min(2).max(100).required(),
    mobile: Joi.string().pattern(/^\d{10}$/).required(),
    aadhar: Joi.string().pattern(/^\d{12}$/).required(),
    age: Joi.alternatives().try(Joi.number().integer().min(1).max(120), Joi.string().trim()).required(),
    gender: Joi.string().trim().required(),
    bloodGroup: Joi.string().trim().allow('', null).optional(),
    village: Joi.string().trim().allow('', null).optional(),
    panchayat: Joi.string().trim().allow('', null).optional(),
    block: Joi.string().trim().allow('', null).optional(),
    district: Joi.string().trim().required(),
    state: Joi.string().trim().required(),
    pincode: Joi.string().pattern(/^\d{6}$/).allow('', null).optional()
});

const healthCardVerifyPaymentSchema = Joi.object({
    razorpay_order_id: Joi.string().trim().required(),
    razorpay_payment_id: Joi.string().trim().required(),
    razorpay_signature: Joi.string().trim().required(),
    pendingOrderId: Joi.string().trim().required()
});

module.exports = {
    hospitalLoginSchema,
    generateCredentialsSchema,
    registerHospitalSchema,
    editHospitalSchema,
    hospitalIdQuerySchema,
    addBillSchema,
    appointmentBookSchema,
    testNotifySchema,
    healthCardCheckExistsSchema,
    healthCardCreateOrderSchema,
    healthCardVerifyPaymentSchema
};
