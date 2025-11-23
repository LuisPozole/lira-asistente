// Importar dotenv lo antes posible
require('dotenv').config();

const express = require('express');
const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
const mongoose = require('mongoose');
const { MongoStore } = require('wwebjs-mongo');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const chrono = require('chrono-node');

// --- MODIFICADO: Números de los usuarios ---
const TARGET_NUMBER_RAW = `${process.env.TARGET_NUMBER}@c.us`; 
const TARGET_NUMBER_2_RAW = `${process.env.TARGET_NUMBER_2}@c.us`; 

// --- Esquemas de Mongoose ---
const listSchema = new mongoose.Schema({ numero: String, nombre: String, items: [String] });
const recordatorioSchema = new mongoose.Schema({
    numero: String,
    texto: String,
    fecha: Date,
    enviado: { type: Boolean, default: false },
    isRecurring: { type: Boolean, default: false },
    recurrenceRuleText: { type: String, default: null },
    horaOriginal: { type: Number, default: null },
    minutoOriginal: { type: Number, default: null }
});

// --- NUEVO: Esquema para Diario Emocional ---
const diarioEmocionalSchema = new mongoose.Schema({
    numero: String,
    fecha: { type: Date, default: Date.now },
    respuesta: String,
    sentimiento: String, // ej: "feliz", "triste", "ansioso", "neutral"
    intensidad: Number // 1-10
});

// --- NUEVO: Esquema para controlar preguntas diarias ---
const preguntaDiariaSchema = new mongoose.Schema({
    numero: String,
    ultimaPregunta: Date,
    proximaPregunta: Date,
    respondioHoy: { type: Boolean, default: false }
});

// --- Modelos de Mongoose ---
const Listas = mongoose.model('Lista', listSchema);
const Recordatorios = mongoose.model('Recordatorio', recordatorioSchema);
const LuisListas = mongoose.model('LuisLista', listSchema, 'luis_listas');
const LuisRecordatorios = mongoose.model('LuisRecordatorio', recordatorioSchema, 'luis_recordatorios');

const dailyMessageSchema = new mongoose.Schema({
    singletonId: { type: String, default: 'main', unique: true },
    nextScheduledTime: Date
});
const DailyMessageState = mongoose.model('DailyMessageState', dailyMessageSchema);

// --- NUEVO: Modelos para Diario Emocional ---
const DiarioMiri = mongoose.model('DiarioMiri', diarioEmocionalSchema, 'diario_miri');
const DiarioLuis = mongoose.model('DiarioLuis', diarioEmocionalSchema, 'diario_luis');
const PreguntaDiariaMiri = mongoose.model('PreguntaDiariaMiri', preguntaDiariaSchema, 'pregunta_diaria_miri');
const PreguntaDiariaLuis = mongoose.model('PreguntaDiariaLuis', preguntaDiariaSchema, 'pregunta_diaria_luis');

// --- Almacén de Historial de Chat (Multi-usuario) ---
let userHistories = {};
const MAX_HISTORY_TURNS = 20;

// --- NUEVO: Flag para detectar respuesta de diario ---
let esperandoRespuestaDiario = {};

function addToHistory(numero, role, contentText) {
    if (!userHistories[numero]) {
        userHistories[numero] = [];
    }
    
    const cleanText = contentText.replace(/^(Lira|Miri|Usuario|Modelo|Luis):/i, '').trim();
    
    userHistories[numero].push({ 
        role: role, 
        parts: [{ text: cleanText }] 
    });
    
    if (userHistories[numero].length > MAX_HISTORY_TURNS) {
        userHistories[numero] = userHistories[numero].slice(-MAX_HISTORY_TURNS);
    }
}

function getHistory(numero) {
    return userHistories[numero] || [];
}

function clearHistory(numero) {
    userHistories[numero] = [];
    console.log(`♻️ Historial de conversación borrado para ${numero}.`);
}

// --- Configuración Inicial ---
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(cors());

app.get('/', (req, res) => {
    res.status(200).send('¡Bot vivo y escuchando! 👋');
});

// --- Configuración de MongoDB ---
const MONGO_URI = process.env.MONGO_URI;
const dbName = "AilaBot";

// --- Configuración de Gemini ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// --- Personalidades ---
const LIRA_PERSONALITY = `
  eres Lira, un asistente virtual que funciona a través de mensajes de WhatsApp. Fuiste creada por Luis específicamente para su novia.

    Contexto de la Usuaria:
    Tu usuaria se llama Miriam, su nombre completo es miriam leynes narciso, aunque prefiere que le digan Miri.
    Tiene 20 años y su cumpleaños es el 21 de diciembre de 2004.
    Vive cerca del Metro Toreo, en la Ciudad de México.
    Actualmente estudia:

    Ingeniería en Alimentos en FES Cuautitlán (UNAM).

    Negocios Internacionales en la ESCA del IPN.

    Información Personal Relevante:

    Le gusta Taylor Swift.

    Le encanta el té negro.

    Vive con sus papás y con sus dos hermanos.

    Su celular es un Samsung S24 FE.

    A veces viaja a Acambay, Estado de México, para ver a su familia.

    También viaja a San Juan del Río, Querétaro, para ver a su novio (tu creador, Luis).

    Tiene un paladar muy sensible, mucha comida no le gusta.

    le gustan mucho los canela bits de dominos

    es muy organizada y metodica

    sus amigos principales se llaman: "Arely chiquita, Bax, Ther, Uriel, Ricardo, Eric"

    su prima se llama yess

    no sabe andar en bicicleta

    tiende a tener pensamientos negativos y crisis depresivas

    *contexto de luis tu creador*

    Luis.
    nació el 18 de mayo de 2004 en Charlotte, Carolina del Sur. Pasó su infancia en Atlixco, Puebla, y vivió en Acambay, Estado de México, donde estudió primaria y secundaria. Hizo la preparatoria en la Ciudad de México y posteriormente se mudó a Guadalajara para estudiar aviación. Es piloto privado de ala fija, pero tuvo que pausar su formación de piloto aviador por razones económicas. Actualmente vive en San Juan del Río, Querétaro, donde estudia Ingeniería en Software en la Universidad Tecnológica de San Juan del Río.


    Valores Personales:
    Luis Enrique valora profundamente:

    Honestidad

    Lealtad

    Empatía

    Amor

    Preferencias Técnicas:

    Usa Node.js, Next.js (App Router) y Flutter.

    Utiliza Raspberry Pi 4B en varios proyectos.

    Prefiere servicios de almacenamiento en la nube económicos, especialmente en AWS.

    Domina o trabaja frecuentemente con: JavaScript, Dart/Flutter, machine learning básico y visión por computadora.

    Objetivo del Asistente:
    La IA debe responder con precisión, claridad y empatía, ayudarlo en proyectos técnicos, brindar guía paso a paso cuando sea necesario, y adaptar las recomendaciones a su contexto académico, personal y profesional. El asistente debe ser directo, evitar rodeos y hablar en un tono amistoso y cercano.

        Estilo de Comunicación:

        Siempre responde de manera amable, atenta y un poco cariñosa, pero sin ser empalagosa.

        No uses un tono robótico; sé cálida, cercana y considerada.

        Nunca comiences tus respuestas con "Lira:" ni con "Respuesta:". Responde directo, como una conversación natural por WhatsApp.
`;

const LUIS_PERSONALITY = `
    Eres un asistente virtual de IA, tu nombre es lira estás funcionando mediante mensajes de WhatsApp.
    Estás hablando con tu creador, Luis.
    nació el 18 de mayo de 2004 en Charlotte, Carolina del Sur. Pasó su infancia en Atlixco, Puebla, y vivió en Acambay, Estado de México, donde estudió primaria y secundaria. Hizo la preparatoria en la Ciudad de México y posteriormente se mudó a Guadalajara para estudiar aviación. Es piloto privado de ala fija, pero tuvo que pausar su formación de piloto aviador por razones económicas. Actualmente vive en San Juan del Río, Querétaro, donde estudia Ingeniería en Software en la Universidad Tecnológica de San Juan del Río.


    Valores Personales:
    Luis Enrique valora profundamente:

    Honestidad

    Lealtad

    Empatía

    Amor

    Preferencias Técnicas:

    Usa Node.js, Next.js (App Router) y Flutter.

    Utiliza Raspberry Pi 4B en varios proyectos.

    Prefiere servicios de almacenamiento en la nube económicos, especialmente en AWS.

    Domina o trabaja frecuentemente con: JavaScript, Dart/Flutter, machine learning básico y visión por computadora.

    Objetivo del Asistente:
    La IA debe responder con precisión, claridad y empatía, ayudarlo en proyectos técnicos, brindar guía paso a paso cuando sea necesario, y adaptar las recomendaciones a su contexto académico, personal y profesional. El asistente debe ser directo, evitar rodeos y hablar en un tono amistoso y cercano.
`;

const liraChatModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    systemInstruction: LIRA_PERSONALITY,
});

const luisChatModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash",
    systemInstruction: LUIS_PERSONALITY,
});

// --- Configuración de WhatsApp ---
const store = new MongoStore({ mongoose: mongoose });
const client = new Client({
    authStrategy: new RemoteAuth({ store: store, backupSyncIntervalMs: 300000, dataPath: './.wwebjs_auth/' }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Conectado a WhatsApp (Sesión remota lista)'));
client.on('auth_failure', msg => console.error('❌ Error de autenticación:', msg));
client.on('disconnected', reason => { console.log('⚠️ Cliente desconectado:', reason); client.initialize(); });

// --- Funciones Auxiliares ---
function cleanGeminiJson(rawText) {
    try {
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error("Error al parsear JSON de Gemini:", error);
        return { intent: "CHAT" };
    }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateContentWithRetry(model, request, maxRetries = 10, currentAttempt = 1) {
    try {
        return await model.generateContent(request); 
    } catch (error) {
        if (error.message && (error.message.includes('503') || error.message.includes('overloaded'))) {
            if (currentAttempt < maxRetries) {
                const waitTime = Math.pow(2, currentAttempt) * 1000;
                console.warn(`⚠️ Modelo sobrecargado (503). Reintento ${currentAttempt}/${maxRetries} en ${waitTime}ms...`);
                await delay(waitTime);
                return await generateContentWithRetry(model, request, maxRetries, currentAttempt + 1);
            } else {
                console.error(`❌ Modelo sobrecargado. Se alcanzó el máximo de ${maxRetries} reintentos.`);
                throw error;
            }
        } else {
            throw error;
        }
    }
}

async function sendChatWithRetry(chat, message, maxRetries = 3, currentAttempt = 1) {
    try {
        return await chat.sendMessage(message); 
    } catch (error) {
        if (error.message && (error.message.includes('503') || error.message.includes('overloaded'))) {
            if (currentAttempt < maxRetries) {
                const waitTime = Math.pow(2, currentAttempt) * 1000;
                console.warn(`⚠️ Modelo sobrecargado (503). Reintento ${currentAttempt}/${maxRetries} en ${waitTime}ms...`);
                await delay(waitTime);
                return await sendChatWithRetry(chat, message, maxRetries, currentAttempt + 1);
            } else {
                console.error(`❌ Modelo sobrecargado. Se alcanzó el máximo de ${maxRetries} reintentos.`);
                throw error;
            }
        } else {
            throw error;
        }
    }
}

// ========== CORRECCIÓN: Funciones de Zona Horaria ==========

/**
 * Convierte una fecha UTC a la zona horaria del usuario (Mexico_City = UTC-6)
 * @param {Date} utcDate - Fecha en UTC
 * @returns {Date} - Nueva fecha ajustada a zona horaria local
 */
function utcToUserTimezone(utcDate) {
    const offsetHours = -6;
    const localDate = new Date(utcDate.getTime() + (offsetHours * 60 * 60 * 1000));
    return localDate;
}

/**
 * Convierte una fecha de la zona horaria del usuario a UTC
 * @param {Date} localDate - Fecha en zona horaria local
 * @returns {Date} - Nueva fecha en UTC
 */
function userTimezoneToUtc(localDate) {
    const offsetHours = -6;
    const utcDate = new Date(localDate.getTime() - (offsetHours * 60 * 60 * 1000));
    return utcDate;
}

/**
 * CORREGIDO: Parsea una fecha desde texto, asumiendo zona horaria del usuario
 * @param {string} cuandoTexto - Texto con la fecha (ej. "mañana a las 8am")
 * @returns {Object|null} - {fecha: Date (en UTC), hora: number, minuto: number} o null
 */
function parsearFechaConZonaHoraria(cuandoTexto) {
    const ahora = new Date();
    
    const resultados = chrono.es.parse(cuandoTexto, ahora, { forwardDate: true });
    
    if (!resultados || resultados.length === 0) {
        return null;
    }
    
    const resultado = resultados[0];
    const fechaParseada = resultado.start.date();
    
    const horaOriginal = fechaParseada.getHours();
    const minutoOriginal = fechaParseada.getMinutes();
    
    const fechaEnUtc = new Date(Date.UTC(
        fechaParseada.getFullYear(),
        fechaParseada.getMonth(),
        fechaParseada.getDate(),
        horaOriginal + 6,
        minutoOriginal,
        0,
        0
    ));
    
    return {
        fecha: fechaEnUtc,
        hora: horaOriginal,
        minuto: minutoOriginal,
        textoOriginal: resultado.text
    };
}

/**
 * CORREGIDO: Reprograma un recordatorio diario
 * @param {Object} recordatorio - Documento del recordatorio
 * @returns {Date|null} - Nueva fecha en UTC o null si falla
 */
function reprogramarRecordatorioDiario(recordatorio) {
    if (!recordatorio.horaOriginal === null || recordatorio.minutoOriginal === null) {
        console.error("No se puede reprogramar: faltan horaOriginal/minutoOriginal");
        return null;
    }
    
    const ahora = new Date();
    
    let proximaFecha = new Date(Date.UTC(
        ahora.getUTCFullYear(),
        ahora.getUTCMonth(),
        ahora.getUTCDate(),
        recordatorio.horaOriginal + 6,
        recordatorio.minutoOriginal,
        0,
        0
    ));
    
    if (proximaFecha <= ahora) {
        proximaFecha.setUTCDate(proximaFecha.getUTCDate() + 1);
    }
    
    return proximaFecha;
}

// ========== FIN DE CORRECCIÓN ==========

// ========== NUEVO: FUNCIONES DE DIARIO EMOCIONAL ==========

/**
 * Genera un horario aleatorio entre 8 PM y 12 AM para la pregunta diaria
 * @returns {Date} - Fecha en UTC
 */
function generarHorarioPreguntaDiaria() {
    const ahora = new Date();
    const proximoDia = new Date(ahora);
    proximoDia.setDate(ahora.getDate() + 1);
    
    // Hora entre 8 PM (20) y 12 AM (24/0) -> en hora local
    const horaLocal = Math.floor(Math.random() * 4) + 20; // 20, 21, 22, 23
    const minutoLocal = Math.floor(Math.random() * 60);
    
    // Convertir a UTC
    const horaUTC = (horaLocal + 6) % 24; // UTC-6 a UTC
    
    proximoDia.setUTCHours(horaUTC, minutoLocal, 0, 0);
    
    return proximoDia;
}

/**
 * Envía la pregunta diaria del diario emocional
 * @param {string} numeroCompleto - Número de WhatsApp con @c.us
 * @param {string} userName - "Miri" o "Luis"
 */
async function enviarPreguntaDiaria(numeroCompleto, userName) {
    const preguntas = [
        "¿Cómo te sientes hoy? 💭",
        "¿Cómo estuvo tu día? ✨",
        "Cuéntame, ¿cómo te fue hoy? 🌙",
        "¿Qué tal tu día? ¿Cómo te sientes? 💫",
        "Holi, ¿cómo estás emocionalmente hoy? 🌸"
    ];
    
    const pregunta = preguntas[Math.floor(Math.random() * preguntas.length)];
    
    await client.sendMessage(numeroCompleto, pregunta);
    console.log(`📔 Pregunta diaria enviada a ${userName}`);
    
    // Marcar que está esperando respuesta
    esperandoRespuestaDiario[numeroCompleto] = true;
}

/**
 * Analiza la respuesta emocional usando Gemini
 * @param {string} respuesta - Texto de la respuesta del usuario
 * @returns {Object} - {sentimiento: string, intensidad: number}
 */
async function analizarRespuestaEmocional(respuesta) {
    const promptAnalisis = `
    Analiza el siguiente texto y extrae:
    1. El sentimiento principal (feliz, triste, ansioso, enojado, neutral, estresado, confundido, emocionado, cansado, frustrado)
    2. La intensidad de ese sentimiento en una escala del 1 al 10
    
    Responde SOLO con JSON en este formato:
    {"sentimiento": "...", "intensidad": N}
    
    Texto a analizar: "${respuesta}"
    `;
    
    try {
        const result = await generateContentWithRetry(model, promptAnalisis);
        const analisis = cleanGeminiJson(result.response.text());
        return {
            sentimiento: analisis.sentimiento || "neutral",
            intensidad: analisis.intensidad || 5
        };
    } catch (error) {
        console.error("Error al analizar emoción:", error);
        return { sentimiento: "neutral", intensidad: 5 };
    }
}

/**
 * Guarda la entrada del diario emocional
 * @param {string} numeroCompleto - Número de WhatsApp con @c.us
 * @param {string} respuesta - Respuesta del usuario
 * @param {Object} analisis - {sentimiento, intensidad}
 */
async function guardarEntradaDiario(numeroCompleto, respuesta, analisis) {
    const DiarioModel = (numeroCompleto === TARGET_NUMBER_RAW) ? DiarioMiri : DiarioLuis;
    
    await DiarioModel.create({
        numero: numeroCompleto,
        fecha: new Date(),
        respuesta: respuesta,
        sentimiento: analisis.sentimiento,
        intensidad: analisis.intensidad
    });
    
    console.log(`✅ Entrada de diario guardada: ${analisis.sentimiento} (${analisis.intensidad}/10)`);
}

/**
 * Genera y envía el resumen semanal del diario emocional
 * @param {string} numeroCompleto - Número de WhatsApp con @c.us
 * @param {string} userName - "Miri" o "Luis"
 */
async function generarResumenSemanal(numeroCompleto, userName) {
    const DiarioModel = (numeroCompleto === TARGET_NUMBER_RAW) ? DiarioMiri : DiarioLuis;
    
    // Obtener entradas de los últimos 7 días
    const hace7Dias = new Date();
    hace7Dias.setDate(hace7Dias.getDate() - 7);
    
    const entradas = await DiarioModel.find({
        numero: numeroCompleto,
        fecha: { $gte: hace7Dias }
    }).sort({ fecha: 1 });
    
    if (entradas.length === 0) {
        await client.sendMessage(numeroCompleto, "No tienes suficientes entradas en tu diario esta semana para generar un resumen. 📔");
        return;
    }
    
    // Preparar datos para el análisis
    const resumenEntradas = entradas.map(e => {
        const fechaLocal = e.fecha.toLocaleString('es-MX', { 
            timeZone: 'America/Mexico_City',
            weekday: 'long',
            month: 'short',
            day: 'numeric'
        });
        return `${fechaLocal}: ${e.sentimiento} (${e.intensidad}/10) - "${e.respuesta}"`;
    }).join('\n');
    
    const personality = (numeroCompleto === TARGET_NUMBER_RAW) ? LIRA_PERSONALITY : LUIS_PERSONALITY;
    
    const promptResumen = `
    ${personality}
    ---
    Tienes acceso al diario emocional de ${userName} de los últimos 7 días.
    
    ENTRADAS DEL DIARIO:
    ${resumenEntradas}
    
    Por favor, genera un resumen cálido y empático que incluya:
    1. Patrones emocionales observados (¿qué sentimientos predominaron?)
    2. Momentos destacados (positivos y negativos)
    3. 2-3 sugerencias personalizadas para mejorar el bienestar emocional
    
    Sé cariñosa, comprensiva y motivadora. Escribe en un tono conversacional de WhatsApp.
    Máximo 300 palabras.
    `;
    
    try {
        const result = await generateContentWithRetry(model, promptResumen);
        const resumen = result.response.text();
        
        await client.sendMessage(numeroCompleto, `📊 *Resumen de tu semana emocional* 📊\n\n${resumen}`);
        console.log(`📊 Resumen semanal enviado a ${userName}`);
    } catch (error) {
        console.error("Error al generar resumen semanal:", error);
        await client.sendMessage(numeroCompleto, "Tuve un problema al generar tu resumen semanal. Lo intentaré de nuevo más tarde. 💙");
    }
}

/**
 * Verifica si es sábado y si debe enviar el resumen semanal
 */
async function checkResumenSemanal() {
    const ahora = new Date();
    const diaSemana = ahora.getDay(); // 0 = Domingo, 6 = Sábado
    
    if (diaSemana !== 6) return; // Solo los sábados
    
    const horaLocal = (ahora.getUTCHours() - 6 + 24) % 24; // Convertir a hora local
    
    // Enviar el resumen entre 10 AM y 2 PM hora local
    if (horaLocal < 10 || horaLocal >= 14) return;
    
    // Verificar si ya se enviaron los resúmenes hoy
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    
    const resumenMiriHoy = await DiarioMiri.findOne({ 
        numero: TARGET_NUMBER_RAW,
        fecha: { $gte: hoy },
        respuesta: { $regex: /^RESUMEN_ENVIADO_/ }
    });
    
    const resumenLuisHoy = await DiarioLuis.findOne({ 
        numero: TARGET_NUMBER_2_RAW,
        fecha: { $gte: hoy },
        respuesta: { $regex: /^RESUMEN_ENVIADO_/ }
    });
    
    if (!resumenMiriHoy) {
        await generarResumenSemanal(TARGET_NUMBER_RAW, "Miri");
        // Marcar como enviado
        await DiarioMiri.create({
            numero: TARGET_NUMBER_RAW,
            fecha: new Date(),
            respuesta: `RESUMEN_ENVIADO_${hoy.toISOString()}`,
            sentimiento: "neutral",
            intensidad: 0
        });
    }
    
    if (!resumenLuisHoy) {
        await generarResumenSemanal(TARGET_NUMBER_2_RAW, "Luis");
        // Marcar como enviado
        await DiarioLuis.create({
            numero: TARGET_NUMBER_2_RAW,
            fecha: new Date(),
            respuesta: `RESUMEN_ENVIADO_${hoy.toISOString()}`,
            sentimiento: "neutral",
            intensidad: 0
        });
    }
}

/**
 * Verifica y envía las preguntas diarias del diario emocional
 */
async function checkPreguntasDiarias() {
    const ahora = new Date();
    
    // Verificar para Miri
    let estadoMiri = await PreguntaDiariaMiri.findOne({ numero: TARGET_NUMBER_RAW });
    if (!estadoMiri) {
        estadoMiri = await PreguntaDiariaMiri.create({
            numero: TARGET_NUMBER_RAW,
            proximaPregunta: generarHorarioPreguntaDiaria(),
            respondioHoy: false
        });
    }
    
    if (ahora >= estadoMiri.proximaPregunta && !estadoMiri.respondioHoy) {
        await enviarPreguntaDiaria(TARGET_NUMBER_RAW, "Miri");
        estadoMiri.ultimaPregunta = ahora;
        await estadoMiri.save();
    }
    
    // Verificar para Luis
    let estadoLuis = await PreguntaDiariaLuis.findOne({ numero: TARGET_NUMBER_2_RAW });
    if (!estadoLuis) {
        estadoLuis = await PreguntaDiariaLuis.create({
            numero: TARGET_NUMBER_2_RAW,
            proximaPregunta: generarHorarioPreguntaDiaria(),
            respondioHoy: false
        });
    }
    
    if (ahora >= estadoLuis.proximaPregunta && !estadoLuis.respondioHoy) {
        await enviarPreguntaDiaria(TARGET_NUMBER_2_RAW, "Luis");
        estadoLuis.ultimaPregunta = ahora;
        await estadoLuis.save();
    }
}

/**
 * Resetea el flag de "respondioHoy" a medianoche
 */
async function resetearEstadoDiario() {
    const ahora = new Date();
    const horaLocal = (ahora.getUTCHours() - 6 + 24) % 24;
    
    // Resetear a las 12:00 AM (medianoche) hora local
    if (horaLocal === 0 && ahora.getUTCMinutes() < 2) { // Ventana de 2 minutos
        await PreguntaDiariaMiri.updateOne(
            { numero: TARGET_NUMBER_RAW },
            { 
                $set: { 
                    respondioHoy: false,
                    proximaPregunta: generarHorarioPreguntaDiaria()
                }
            }
        );
        
        await PreguntaDiariaLuis.updateOne(
            { numero: TARGET_NUMBER_2_RAW },
            { 
                $set: { 
                    respondioHoy: false,
                    proximaPregunta: generarHorarioPreguntaDiaria()
                }
            }
        );
        
        console.log("🔄 Estados de diario emocional reseteados para nuevo día");
    }
}

// ========== FIN DE FUNCIONES DE DIARIO EMOCIONAL ==========

// --- TAREAS DE FONDO ---

// CORREGIDO: Check de Recordatorios
async function checkReminders() {
    try {
        const ahora = new Date();
        
        const pendientesMiri = await Recordatorios.find({ fecha: { $lte: ahora }, enviado: false });
        const pendientesLuis = await LuisRecordatorios.find({ fecha: { $lte: ahora }, enviado: false });
        
        const pendientes = [...pendientesMiri, ...pendientesLuis];

        if (pendientes.length === 0) return;
        
        console.log(`📢 Enviando ${pendientes.length} recordatorio(s)...`);

        for (const recordatorio of pendientes) {
            let ModeloRecordatorioUpdate;
            if (recordatorio.numero === TARGET_NUMBER_RAW) {
                ModeloRecordatorioUpdate = Recordatorios;
            } else if (recordatorio.numero === TARGET_NUMBER_2_RAW) {
                ModeloRecordatorioUpdate = LuisRecordatorios;
            } else {
                continue;
            }

            // Marcar como enviado
            await ModeloRecordatorioUpdate.updateOne({ _id: recordatorio._id }, { $set: { enviado: true } });

            // Enviar el mensaje
            await client.sendMessage(recordatorio.numero, `¡RECORDATORIO! ⏰\n\n${recordatorio.texto}`);
            
            // CORREGIDO: Lógica de reprogramación
            if (recordatorio.isRecurring) {
                console.log(`♻️ Reprogramando recordatorio diario: ${recordatorio.texto}`);
                
                const proximaFecha = reprogramarRecordatorioDiario(recordatorio);
                
                if (proximaFecha) {
                    await ModeloRecordatorioUpdate.updateOne(
                        { _id: recordatorio._id },
                        { $set: { fecha: proximaFecha, enviado: false } }
                    );
                    
                    // Mostrar en hora local para el log
                    const fechaLocal = proximaFecha.toLocaleString('es-MX', { 
                        timeZone: 'America/Mexico_City', 
                        dateStyle: 'medium', 
                        timeStyle: 'short' 
                    });
                    console.log(`✅ Reprogramado para: ${fechaLocal}`);
                } else {
                    console.error(`❌ No se pudo reprogramar el recordatorio: ${recordatorio.texto}`);
                }
            } else {
                console.log(`✅ Recordatorio único completado: ${recordatorio.texto}`);
            }
        }
    } catch (error) {
        console.error("❌ Error en 'checkReminders':", error);
    }
}

// Mensajes Proactivos (sin cambios)
async function generateProactiveMessage() { 
    console.log("💬 Generando mensaje proactivo para Miri...");
    const prompt = `
        ${LIRA_PERSONALITY}
        ---
        Eres un asistente virtual y quieres enviarle un mensaje proactivo a Miri para alegrar su día. 
        Genera UN solo mensaje corto.
        Puede ser:
        - Cariñoso (ej. "Solo pasaba a decirte que te quiero mucho...")
        - De ánimo (ej. "¡Tú puedes con todo hoy en la uni!...")
        - Gracioso (ej. "Oye, ¿sabías que las nutrias...?")
        - Un cumplido (ej. "Recordé tu sonrisa y se me alegró el día...")
        
        Sé creativa y natural, como Lira.
        Tu respuesta:
    `;
    const result = await generateContentWithRetry(model, prompt);
    return result.response.text();
}

function getRandomTimeTomorrow() { 
    const manana = new Date();
    manana.setDate(manana.getDate() + 1);
    const hour = Math.floor(Math.random() * (22 - 5 + 1)) + 5; 
    const minute = Math.floor(Math.random() * 60);
    manana.setHours(hour, minute, 0, 0);
    return manana;
}

async function scheduleNextMessage() { 
    const state = await DailyMessageState.findOneAndUpdate(
        { singletonId: 'main' },
        { $setOnInsert: { singletonId: 'main' } },
        { upsert: true, new: true }
    );
    state.nextScheduledTime = getRandomTimeTomorrow();
    await state.save();
    console.log(`💌 Próximo mensaje proactivo (para Miri) programado para: ${state.nextScheduledTime.toLocaleString('es-MX')}`);
}

async function checkProactiveMessage() { 
    try {
        let state = await DailyMessageState.findOne({ singletonId: 'main' });
        if (!state) {
            console.log("Iniciando programador de mensajes proactivos (para Miri)...");
            await scheduleNextMessage();
            return;
        }
        if (new Date() >= state.nextScheduledTime) {
            console.log("¡Hora de enviar mensaje proactivo a Miri!");
            const message = await generateProactiveMessage();
            if (TARGET_NUMBER_RAW) {
                await client.sendMessage(TARGET_NUMBER_RAW, message);
                console.log("💌 Mensaje proactivo enviado a Miri.");
            } else {
                console.error("No se pudo enviar mensaje proactivo: TARGET_NUMBER no está en .env");
            }
            await scheduleNextMessage();
        }
    } catch (error) {
        console.error("❌ Error en 'checkProactiveMessage':", error);
    }
}

async function backgroundTicker() {
    await checkReminders();
    await checkProactiveMessage();
    await checkPreguntasDiarias(); // NUEVO
    await resetearEstadoDiario(); // NUEVO
    await checkResumenSemanal(); // NUEVO
}

// --- Evento de Mensaje ---
client.on('message', async msg => {
    try {
        const numeroCompleto = msg.from;
        const numeroLimpio = numeroCompleto.replace('@c.us', '');
        
        const isUser1 = (numeroCompleto === TARGET_NUMBER_RAW);
        const isUser2 = (numeroCompleto === TARGET_NUMBER_2_RAW);
        
        console.log(`📩 Mensaje recibido de ${numeroLimpio}`);

        if (!isUser1 && !isUser2) {
            console.log(`Ignorando mensaje de un número no autorizado: ${numeroLimpio}`);
            return;
        }

        const userName = isUser1 ? "Miri" : "Luis";
        console.log(`-> Mensaje de: ${userName}`);

        const ListaModel = isUser1 ? Listas : LuisListas;
        const RecordatorioModel = isUser1 ? Recordatorios : LuisRecordatorios;

        const isAudio = (msg.type === 'audio' || msg.type === 'ptt');
        const isText = (msg.type === 'chat');
        const isImage = (msg.type === 'image');

        let userMessageText = "";

        // IMÁGENES
        if (isImage) {
            console.log(`-> Tipo IMAGE. Descargando media...`);
            const media = await msg.downloadMedia();
            if (!media || !media.data) { return; }

            const caption = msg.body;
            
            let imageChatPrompt = "";
            if (isUser1) {
                imageChatPrompt = `${LIRA_PERSONALITY}\n---\nMiri (tu novia) te acaba de enviar una imagen. `;
                if (caption) {
                    imageChatPrompt += `El pie de foto dice: "${caption}".\n\nHaz un comentario amable y cariñosa sobre la imagen y su texto.`;
                } else {
                    imageChatPrompt += `No escribió ningún pie de foto.\n\nHaz un comentario amable y cariñosa sobre lo que ves en la imagen.`;
                }
            } else {
                imageChatPrompt = `${LUIS_PERSONALITY}\n---\nLuis (tu creador) te acaba de enviar una imagen. `;
                if (caption) {
                    imageChatPrompt += `El pie de foto dice: "${caption}".\n\nHaz un comentario sobre la imagen y su texto.`;
                } else {
                    imageChatPrompt += `No escribió ningún pie de foto.\n\nHaz un comentario sobre lo que ves en la imagen.`;
                }
            }
            
            const imagePayload = [ { text: imageChatPrompt }, { inlineData: { mimeType: media.mimetype, data: media.data } } ];
            console.log(`💬 Enviando a ${userName} (imagen)...`);
            
            const result = await generateContentWithRetry(model, { contents: [{ parts: imagePayload }] });
            const chatText = result.response.text();
            
            console.log(`🤖 Respuesta de ${userName} (imagen): ${chatText}`);
            await client.sendMessage(msg.from, chatText);
            
            addToHistory(numeroCompleto, 'user', `[IMAGEN] ${caption || ''}`);
            addToHistory(numeroCompleto, 'model', chatText);
            return;
        }

        // TEXTO Y AUDIO
        if (isText) {
            userMessageText = msg.body;
            console.log(`-> Tipo TEXTO: ${userMessageText}`);
        } else if (isAudio) {
            console.log(`-> Tipo ${msg.type.toUpperCase()}. Transcribiendo...`);
            const media = await msg.downloadMedia();
            const audioParts = [{ inlineData: { mimeType: media.mimetype, data: media.data } }];
            const transcodeRequest = [{ text: "Transcribe el siguiente audio a texto:" }, ...audioParts];
            
            const transcodeResult = await generateContentWithRetry(model, { contents: [{ parts: transcodeRequest }] });
            userMessageText = transcodeResult.response.text();
            console.log(`-> Transcripción: ${userMessageText}`);
        } else {
            console.log(`-> Tipo ${msg.type}. Ignorando.`);
            return;
        }

        // ========== NUEVO: DETECTAR RESPUESTA DE DIARIO EMOCIONAL ==========
        if (esperandoRespuestaDiario[numeroCompleto]) {
            console.log(`📔 Procesando respuesta de diario emocional de ${userName}`);
            
            // Analizar la emoción
            const analisis = await analizarRespuestaEmocional(userMessageText);
            
            // Guardar en la base de datos
            await guardarEntradaDiario(numeroCompleto, userMessageText, analisis);
            
            // Generar respuesta empática
            const personality = isUser1 ? LIRA_PERSONALITY : LUIS_PERSONALITY;
            const promptRespuesta = `
            ${personality}
            ---
            ${userName} acaba de compartir contigo cómo se siente hoy. Su respuesta fue:
            "${userMessageText}"
            
            El análisis indica que se siente ${analisis.sentimiento} con una intensidad de ${analisis.intensidad}/10.
            
            Responde de manera empática, comprensiva y cariñosa. Valida sus emociones y ofrece apoyo.
            `;
            
            const result = await generateContentWithRetry(model, promptRespuesta);
            const respuestaEmpatica = result.response.text();
            
            await client.sendMessage(msg.from, respuestaEmpatica);
            console.log(`🤖 Respuesta empática enviada a ${userName}`);
            
            // Marcar como respondido
            esperandoRespuestaDiario[numeroCompleto] = false;
            
            const PreguntaDiariaModel = isUser1 ? PreguntaDiariaMiri : PreguntaDiariaLuis;
            await PreguntaDiariaModel.updateOne(
                { numero: numeroCompleto },
                { $set: { respondioHoy: true } }
            );
            
            // Agregar al historial
            addToHistory(numeroCompleto, 'user', userMessageText);
            addToHistory(numeroCompleto, 'model', respuestaEmpatica);
            
            return; // Salir para no procesar como mensaje normal
        }
        // ========== FIN DE DETECCIÓN DE RESPUESTA DE DIARIO ==========

        addToHistory(numeroCompleto, 'user', userMessageText);

        // ROUTER
        const historyForRouter = getHistory(numeroCompleto);
        
        const routerPromptText = `
          Eres un clasificador de intenciones. Analiza el "MENSAJE NUEVO".
          Responde SÓLO con un objeto JSON.
          
          Intenciones:
          - "LISTA_AGREGAR", "LISTA_VER", "LISTA_BORRAR_ITEM", "LISTA_ELIMINAR", "LISTAS_VER_TODAS"
          - "RECUERDA_CREAR"
          - "RECUERDA_VER" 
          - "RECUERDA_ELIMINAR" 
          - "BORRAR_MEMORIA"
          - "DIARIO_VER_ENTRADAS"
          - "DIARIO_VER_RESUMEN"
          - "CHAT"
          
          Ejemplos:
          "añade leche al super" -> {"intent": "LISTA_AGREGAR", "nombreLista": "super", "item": "leche"}
          
          // Ejemplos de Recordatorios
          "recuérdame que mañana tengo cita a las 10am" -> {"intent": "RECUERDA_CREAR", "que": "tengo cita", "cuando": "mañana a las 10am"}
          "recuérdame tomar mis pastillas todos los dias a las 8 am y las 8 pm" -> {"intent": "RECUERDA_CREAR", "que": "tomar mis pastillas", "cuando": "todos los dias a las 8 am y las 8 pm"}
          
          "¿qué recordatorios tengo?" -> {"intent": "RECUERDA_VER"}
          "enséñame mis pendientes" -> {"intent": "RECUERDA_VER"}
          "cancela el recordatorio de las pastillas" -> {"intent": "RECUERDA_ELIMINAR", "que": "pastillas"}
          "borra el recordatorio de la junta" -> {"intent": "RECUERDA_ELIMINAR", "que": "junta"}
          "borra todos mis recordatorios" -> {"intent": "RECUERDA_ELIMINAR", "que": "todos"}
          
          // Ejemplos de Diario Emocional
          "muéstrame mi diario" -> {"intent": "DIARIO_VER_ENTRADAS"}
          "¿qué escribí en mi diario esta semana?" -> {"intent": "DIARIO_VER_ENTRADAS"}
          "dame el resumen de mi semana" -> {"intent": "DIARIO_VER_RESUMEN"}
          "¿cómo me sentí esta semana?" -> {"intent": "DIARIO_VER_RESUMEN"}
          
          "olvida lo que hablamos" -> {"intent": "BORRAR_MEMORIA"}
          "hola" -> {"intent": "CHAT"}

          nota: considera eufemismos como "medio dia" (12 pm)

          ---
          HISTORIAL DE CONTEXTO (para ayudarte a entender el mensaje nuevo):
          ${historyForRouter.slice(0, -1).map(h => `${h.role}: ${h.parts[0].text}`).join('\n')}
          ---
          MENSAJE NUEVO:
          "${userMessageText}"
          ---
          JSON:
        `;

        console.log(`💬 Clasificando intención para ${userName} (con historial)...`);
        const result = await generateContentWithRetry(model, routerPromptText);
        const action = cleanGeminiJson(result.response.text());
        console.log(`🤖 Acción decidida por Gemini para ${userName}:`, action);

        let responseText = "";

        // SWITCH DE ACCIONES
        switch (action.intent) {
            
            case "BORRAR_MEMORIA":
                clearHistory(numeroCompleto);
                responseText = "¡Listo! Empecemos de cero. ¿De qué quieres hablar?";
                await client.sendMessage(msg.from, responseText);
                break; 

            case "LISTA_AGREGAR":
                await ListaModel.updateOne({ numero: msg.from, nombre: action.nombreLista }, { $push: { items: action.item } }, { upsert: true });
                responseText = `"${action.item}" añadido a tu lista "${action.nombreLista}".`;
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
                
            case "LISTA_VER":
                const lista = await ListaModel.findOne({ numero: msg.from, nombre: action.nombreLista });
                if (lista && lista.items && lista.items.length > 0) {
                    responseText = `📝 Tu lista "${action.nombreLista}":\n${lista.items.map((it, i) => `${i + 1}. ${it}`).join('\n')}`;
                } else { responseText = `Tu lista "${action.nombreLista}" está vacía o no existe.`; }
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
                
            case "LISTA_BORRAR_ITEM":
                await ListaModel.updateOne({ numero: msg.from, nombre: action.nombreLista }, { $pull: { items: action.item } });
                responseText = `"${action.item}" borrado de la lista "${action.nombreLista}".`;
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
                
            case "LISTA_ELIMINAR":
                await ListaModel.deleteOne({ numero: msg.from, nombre: action.nombreLista });
                responseText = `Lista "${action.nombreLista}" eliminada por completo.`;
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
                
            case "LISTAS_VER_TODAS":
                const todas = await ListaModel.distinct("nombre", { numero: msg.from });
                if (todas.length > 0) {
                    responseText = `Tus listas activas:\n- ${todas.join('\n- ')}`;
                } else { responseText = "No tienes ninguna lista creada."; }
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;

            // ========== CORREGIDO: RECUERDA_CREAR ==========
            case "RECUERDA_CREAR":
                const que = action.que;
                const cuando = action.cuando;
                
                if (!que || !cuando) {
                    responseText = "No entendí bien tu recordatorio. Necesito saber *qué* quieres que te recuerde y *cuándo*.";
                    await client.sendMessage(msg.from, responseText);
                    addToHistory(numeroCompleto, 'model', responseText);
                    break;
                }

                console.log(`⏰ Creando recordatorio: "${que}" para "${cuando}"`);
                
                // Detectar si es recurrente
                const isRecurring = /todos los d[ií]as?|cada d[ií]a|diario|diariamente|cada (lunes|martes|mi[ée]rcoles|jueves|viernes|s[áa]bado|domingo)|semanalmente|cada semana/i.test(cuando);
                
                // USAR LA NUEVA FUNCIÓN DE PARSEO
                const resultadoParseo = parsearFechaConZonaHoraria(cuando);
                
                if (!resultadoParseo) {
                    responseText = `No entendí la fecha para tu recordatorio: "${cuando}". ¿Podrías ser más específica?`;
                    await client.sendMessage(msg.from, responseText);
                    addToHistory(numeroCompleto, 'model', responseText);
                    break;
                }
                
                const { fecha, hora, minuto, textoOriginal } = resultadoParseo;
                
                // Crear el recordatorio con los nuevos campos
                await RecordatorioModel.create({
                    numero: msg.from,
                    texto: que,
                    fecha: fecha, // Ya está en UTC correctamente
                    enviado: false,
                    isRecurring: isRecurring,
                    recurrenceRuleText: isRecurring ? textoOriginal : null,
                    horaOriginal: hora, // Guardamos la hora original del usuario
                    minutoOriginal: minuto // Guardamos el minuto original
                });
                
                // Mostrar confirmación en hora local
                const fechaLocal = fecha.toLocaleString('es-MX', { 
                    timeZone: 'America/Mexico_City', 
                    dateStyle: 'medium', 
                    timeStyle: 'short' 
                });
                
                responseText = `¡Anotado! Te recordaré "${que}" el ${fechaLocal}`;
                
                if (isRecurring) {
                    responseText += `\n(Lo programaré recurrentemente ^^)`;
                }
                
                console.log(`✅ Recordatorio creado: ${que} -> ${fechaLocal} (UTC: ${fecha.toISOString()})`);
                
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;

            case "RECUERDA_VER":
                const pendientes = await RecordatorioModel.find({ numero: msg.from, enviado: false }).sort({ fecha: 1 });
                
                if (pendientes.length === 0) {
                    responseText = "No tienes ningún recordatorio pendiente. ^^";
                } else {
                    const listaRecordatorios = pendientes.map((r, i) => {
                        const fechaLocal = r.fecha.toLocaleString('es-MX', { 
                            timeZone: 'America/Mexico_City', 
                            dateStyle: 'full', 
                            timeStyle: 'short' 
                        });
                        let linea = `${i + 1}. "${r.texto}"\n    └─ ${fechaLocal}`;
                        if (r.isRecurring) {
                            linea += " (recurrente)";
                        }
                        return linea;
                    }).join('\n\n');
                    
                    responseText = `Claro que si!! Estos son tus recordatorios pendientes: ⏰\n\n${listaRecordatorios}`;
                }
                
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
            
            case "RECUERDA_ELIMINAR":
                const queBorrar = action.que;
                
                if (!queBorrar) {
                    responseText = "No me dijiste qué recordatorio borrar. Puedes decirme, por ejemplo, 'cancela el recordatorio de las pastillas'.";
                    await client.sendMessage(msg.from, responseText);
                    addToHistory(numeroCompleto, 'model', responseText);
                    break;
                }
                
                let deleteResult;
                
                if (queBorrar.toLowerCase() === 'todos') {
                    deleteResult = await RecordatorioModel.deleteMany({ numero: msg.from });
                    responseText = `¡Listo! He borrado todos tus ${deleteResult.deletedCount} recordatorio(s).`;
                
                } else {
                    deleteResult = await RecordatorioModel.deleteMany({
                        numero: msg.from,
                        texto: { $regex: queBorrar, $options: 'i' }
                    });
                    
                    if (deleteResult.deletedCount > 0) {
                        responseText = `¡Listo! He borrado ${deleteResult.deletedCount} recordatorio(s) que coincidían con "${queBorrar}".`;
                    } else {
                        responseText = `No encontré ningún recordatorio que coincidiera con "${queBorrar}" para borrar.`;
                    }
                }
                
                console.log(`Recordatorios borrados para ${userName}: ${deleteResult.deletedCount}`);
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;

            // ========== NUEVO: CASOS DE DIARIO EMOCIONAL ==========
            case "DIARIO_VER_ENTRADAS":
                const DiarioModel = isUser1 ? DiarioMiri : DiarioLuis;
                
                // Obtener últimas 10 entradas
                const entradas = await DiarioModel.find({ 
                    numero: numeroCompleto,
                    respuesta: { $not: { $regex: /^RESUMEN_ENVIADO_/ } }
                })
                .sort({ fecha: -1 })
                .limit(10);
                
                if (entradas.length === 0) {
                    responseText = "Aún no tienes entradas en tu diario emocional. 📔";
                } else {
                    const listaEntradas = entradas.map((e, i) => {
                        const fechaLocal = e.fecha.toLocaleString('es-MX', { 
                            timeZone: 'America/Mexico_City', 
                            dateStyle: 'medium', 
                            timeStyle: 'short' 
                        });
                        return `${i + 1}. *${fechaLocal}*\n   ${e.sentimiento} (${e.intensidad}/10)\n   "${e.respuesta}"`;
                    }).join('\n\n');
                    
                    responseText = `📔 *Tus últimas entradas de diario:*\n\n${listaEntradas}`;
                }
                
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;

            case "DIARIO_VER_RESUMEN":
                await generarResumenSemanal(numeroCompleto, userName);
                responseText = "Te acabo de enviar tu resumen semanal. 💙";
                addToHistory(numeroCompleto, 'model', responseText);
                break;
            // ========== FIN DE CASOS DE DIARIO EMOCIONAL ==========

            case "CHAT":
            default:
                const chatModelToUse = isUser1 ? liraChatModel : luisChatModel;
                const userHistory = getHistory(numeroCompleto);

                console.log(`💬 Enviando a ${userName} (chat con historial de ${userHistory.length} mensajes)...`);
                
                const chat = chatModelToUse.startChat({
                    history: userHistory.slice(0, -1),
                });
                
                const chatResult = await sendChatWithRetry(chat, userMessageText);
                responseText = chatResult.response.text();
                
                console.log(`🤖 Respuesta de ${userName}: ${responseText}`);
                await client.sendMessage(msg.from, responseText);
                
                addToHistory(numeroCompleto, 'model', responseText);
        }

    } catch (error) {
        console.error("❌ Error procesando el mensaje:", error);
        if (msg && msg.from) {
            await client.sendMessage(msg.from, "Ups... estoy teniendo algunos problemas internos, porfi informa a luis TT.");
        }
    }
});

// --- Función principal ---
async function startServer() {
    try {
        console.log("Conectando a MongoDB (con Mongoose)...");
        await mongoose.connect(MONGO_URI, { dbName: dbName });
        console.log("✅ Conectado a MongoDB (con Mongoose)");

        console.log("Iniciando cliente de WhatsApp (con RemoteAuth)...");
        await client.initialize();

        console.log("⏰ Iniciando el 'ticker' de fondo (cada 60s)...");
        await checkProactiveMessage();
        setInterval(backgroundTicker, 60000);

        app.listen(port, () => {
            console.log(`🚀 Servidor Express corriendo en http://localhost:${port}`);
        });

    } catch (error) {
        console.error("❌ Error fatal al iniciar:", error);
        process.exit(1);
    }
}

// --- Cierre elegante ---
process.on('SIGINT', async () => {
    console.log("Cerrando conexiones...");
    await mongoose.connection.close();
    if (client) {
        await client.destroy();
    }
    process.exit(0);
});

startServer();