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
// Usuario 1 (Miri) - Recibe mensajes proactivos
const TARGET_NUMBER_RAW = `${process.env.TARGET_NUMBER}@c.us`; 
// Usuario 2 (Luis) - No recibe mensajes proactivos
const TARGET_NUMBER_2_RAW = `${process.env.TARGET_NUMBER_2}@c.us`; 

// --- Esquemas de Mongoose ---
const listSchema = new mongoose.Schema({ numero: String, nombre: String, items: [String] });
const recordatorioSchema = new mongoose.Schema({
    numero: String,
    texto: String,
    fecha: Date,
    enviado: { type: Boolean, default: false },
    isRecurring: { type: Boolean, default: false },
    recurrenceRuleText: { type: String, default: null } 
});

// --- Modelos de Mongoose (Colecciones separadas) ---
const Listas = mongoose.model('Lista', listSchema); 
const Recordatorios = mongoose.model('Recordatorio', recordatorioSchema); 

const LuisListas = mongoose.model('LuisLista', listSchema, 'luis_listas'); 
const LuisRecordatorios = mongoose.model('LuisRecordatorio', recordatorioSchema, 'luis_recordatorios'); 

// Modelo para el mensaje diario
const dailyMessageSchema = new mongoose.Schema({
    singletonId: { type: String, default: 'main', unique: true },
    nextScheduledTime: Date
});
const DailyMessageState = mongoose.model('DailyMessageState', dailyMessageSchema);

// --- Almacén de Historial de Chat (Multi-usuario) ---
let userHistories = {}; 
const MAX_HISTORY_TURNS = 20;

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
const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }); 

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

Intereses y Proyectos Actuales:

Está desarrollando varios proyectos tecnológicos, entre ellos:

Un asistente virtual IoT llamado AILA, basado en Raspberry Pi 4B, con API Gemini y control de dispositivos inteligentes.

Un sistema de reconocimiento facial con OpenCV y face_recognition.

Aplicaciones en Flutter, incluyendo:

Un juego de mascota virtual para su novia.

Una app conectada a la NASA API.

Trabaja con AgroTech Robótica en proyectos que incluyen machine learning.

Reutiliza laptops viejas con distribuciones Linux ligeras.

Usa MongoDB y cambió los nombres de sus colecciones a: Copas, Juegos, Jugadores.

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

    Nunca comiences tus respuestas con “Lira:” ni con “Respuesta:”. Responde directo, como una conversación natural por WhatsApp.
`;

const LUIS_PERSONALITY = `
    Eres un asistente virtual de IA, estás funcionando mediante mensajes de WhatsApp.
    Estás hablando con tu creador, Luis.
    nació el 18 de mayo de 2004 en Charlotte, Carolina del Sur. Pasó su infancia en Atlixco, Puebla, y vivió en Acambay, Estado de México, donde estudió primaria y secundaria. Hizo la preparatoria en la Ciudad de México y posteriormente se mudó a Guadalajara para estudiar aviación. Es piloto privado de ala fija, pero tuvo que pausar su formación de piloto aviador por razones económicas. Actualmente vive en San Juan del Río, Querétaro, donde estudia Ingeniería en Software en la Universidad Tecnológica de San Juan del Río.

Intereses y Proyectos Actuales:

Está desarrollando varios proyectos tecnológicos, entre ellos:

Un asistente virtual IoT llamado AILA, basado en Raspberry Pi 4B, con API Gemini y control de dispositivos inteligentes.

Un sistema de reconocimiento facial con OpenCV y face_recognition.

Aplicaciones en Flutter, incluyendo:

Un juego de mascota virtual para su novia.

Una app conectada a la NASA API.

Trabaja con AgroTech Robótica en proyectos que incluyen machine learning.

Reutiliza laptops viejas con distribuciones Linux ligeras.

Usa MongoDB y cambió los nombres de sus colecciones a: Copas, Juegos, Jugadores.

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
    model: "gemini-2.0-flash", 
    systemInstruction: LIRA_PERSONALITY,
});

const luisChatModel = genAI.getGenerativeModel({ 
    model: "gemini-2.0-flash", 
    systemInstruction: LUIS_PERSONALITY,
});

// --- Configuración de WhatsApp con RemoteAuth ---
const store = new MongoStore({ mongoose: mongoose });
const client = new Client({
    authStrategy: new RemoteAuth({ store: store, backupSyncIntervalMs: 300000, dataPath: './.wwebjs_auth/' }),
    puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

// --- Eventos de WhatsApp ---
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

// --- Funciones de Reintento ---
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function generateContentWithRetry(model, request, maxRetries = 3, currentAttempt = 1) {
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
                await delay(waitTime);
                return await sendChatWithRetry(chat, message, maxRetries, currentAttempt + 1);
            } else {
                throw error;
            }
        } else {
            throw error;
        }
    }
}

// --- TAREAS DE FONDO (TICKER) ---

// --- 1. Check de Recordatorios CORREGIDO ---
async function checkReminders() {
    try {
        const ahora = new Date();
        
        const pendientesMiri = await Recordatorios.find({ fecha: { $lte: ahora }, enviado: false });
        const pendientesLuis = await LuisRecordatorios.find({ fecha: { $lte: ahora }, enviado: false });
        
        const pendientes = [...pendientesMiri, ...pendientesLuis];

        if (pendientes.length === 0) return;
        
        console.log(`⏰ Procesando ${pendientes.length} recordatorios...`);

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

            // Enviar mensaje
            await client.sendMessage(recordatorio.numero, `¡RECORDATORIO! ⏰\n\n${recordatorio.texto}`);
            
            // Lógica de Recurrencia MEJORADA
            if (recordatorio.isRecurring && recordatorio.recurrenceRuleText) {
                console.log(`🔄 Reprogramando recordatorio: ${recordatorio.texto}`);
                
                let proximaFecha = null;
                const rule = recordatorio.recurrenceRuleText.toLowerCase();
                // Usamos la fecha original del recordatorio como base, no "ahora", para evitar que se corra la hora
                const baseDate = new Date(recordatorio.fecha); 

                // Detectar patrones simples para evitar drift de tiempo
                if (rule.match(/diario|cada d(í|i)a|todos los d(í|i)as|siempre/)) {
                    // Sumar exactamente 24 horas
                    baseDate.setDate(baseDate.getDate() + 1);
                    proximaFecha = baseDate;
                } else if (rule.match(/semana/)) {
                    // Sumar exactamente 7 días
                    baseDate.setDate(baseDate.getDate() + 7);
                    proximaFecha = baseDate;
                } else {
                    // Fallback a Chrono para reglas complejas (ej. "cada lunes")
                    // Parseamos desde "ahora" hacia adelante
                    const parsedDate = chrono.es.parse(rule, new Date(), { forwardDate: true });
                    
                    if (parsedDate.length > 0) {
                        proximaFecha = parsedDate[0].start.date();
                        // IMPORTANTE: Si usamos chrono, nos devuelve hora UTC server.
                        // Tenemos que aplicar el SHIFT de México (+6h) de nuevo.
                        proximaFecha.setHours(proximaFecha.getHours() + 6);
                    }
                }

                if (proximaFecha && proximaFecha > new Date()) {
                    await ModeloRecordatorioUpdate.updateOne(
                        { _id: recordatorio._id },
                        { $set: { fecha: proximaFecha, enviado: false } } // Reset enviado a false
                    );
                    console.log(`✅ Reprogramado para: ${proximaFecha.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`);
                } else {
                    console.error(`⚠️ No se pudo calcular proxima fecha para: ${rule}`);
                }
            }
        }
    } catch (error) {
        console.error("❌ Error en 'checkReminders':", error);
    }
}

// --- 2. Check de Mensaje Proactivo (Sin cambios) ---
async function generateProactiveMessage() { 
    console.log("💬 Generando mensaje proactivo para Miri...");
    const prompt = `
        ${LIRA_PERSONALITY}
        ---
        Acabas de despertar y quieres enviarle un mensaje proactivo a Miri para alegrar su día. 
        Genera UN solo mensaje corto (1-3 frases).
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
    console.log(`💌 Próximo mensaje proactivo programado para: ${state.nextScheduledTime.toLocaleString('es-MX')}`);
}

async function checkProactiveMessage() { 
    try {
        let state = await DailyMessageState.findOne({ singletonId: 'main' });
        if (!state) {
            await scheduleNextMessage();
            return;
        }
        if (new Date() >= state.nextScheduledTime) {
            console.log("¡Hora de enviar mensaje proactivo a Miri!");
            const message = await generateProactiveMessage();
            if (TARGET_NUMBER_RAW) {
                await client.sendMessage(TARGET_NUMBER_RAW, message);
                console.log("💌 Mensaje proactivo enviado a Miri.");
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
            return;
        }

        const userName = isUser1 ? "Miri" : "Luis";
        const ListaModel = isUser1 ? Listas : LuisListas;
        const RecordatorioModel = isUser1 ? Recordatorios : LuisRecordatorios;

        const isAudio = (msg.type === 'audio' || msg.type === 'ptt');
        const isText = (msg.type === 'chat');
        const isImage = (msg.type === 'image');

        let userMessageText = "";

        // --- LÓGICA IMÁGENES ---
        if (isImage) {
            const media = await msg.downloadMedia();
            if (!media || !media.data) return;

            const caption = msg.body;
            let imageChatPrompt = "";
            if (isUser1) {
                imageChatPrompt = `${LIRA_PERSONALITY}\n---\nMiri te envía imagen. Pie: "${caption}". Comenta amablemente.`;
            } else {
                imageChatPrompt = `${LUIS_PERSONALITY}\n---\nLuis te envía imagen. Pie: "${caption}". Comenta.`;
            }
            
            const imagePayload = [ { text: imageChatPrompt }, { inlineData: { mimeType: media.mimetype, data: media.data } } ];
            const result = await generateContentWithRetry(model, { contents: [{ parts: imagePayload }] });
            const chatText = result.response.text();
            
            await client.sendMessage(msg.from, chatText);
            addToHistory(numeroCompleto, 'user', `[IMAGEN] ${caption || ''}`);
            addToHistory(numeroCompleto, 'model', chatText);
            return;
        }

        // --- LÓGICA TEXTO Y AUDIO ---
        if (isText) {
            userMessageText = msg.body;
        } else if (isAudio) {
            const media = await msg.downloadMedia();
            const audioParts = [{ inlineData: { mimeType: media.mimetype, data: media.data } }];
            const transcodeRequest = [{ text: "Transcribe el audio:" }, ...audioParts];
            const transcodeResult = await generateContentWithRetry(model, { contents: [{ parts: transcodeRequest }] });
            userMessageText = transcodeResult.response.text();
        } else {
            return;
        }

        addToHistory(numeroCompleto, 'user', userMessageText);

        const historyForRouter = getHistory(numeroCompleto);
        const routerPromptText = `
          Eres un clasificador de intenciones. Responde JSON.
          Intenciones: "LISTA_AGREGAR", "LISTA_VER", "LISTA_BORRAR_ITEM", "LISTA_ELIMINAR", "LISTAS_VER_TODAS", "RECUERDA_CREAR", "RECUERDA_VER", "RECUERDA_ELIMINAR", "BORRAR_MEMORIA", "CHAT".
          
          Ejemplos:
          "añade leche al super" -> {"intent": "LISTA_AGREGAR", "nombreLista": "super", "item": "leche"}
          "recuérdame cita mañana 10am" -> {"intent": "RECUERDA_CREAR", "que": "cita", "cuando": "mañana 10am"}
          "hola" -> {"intent": "CHAT"}

          HISTORIAL:
          ${historyForRouter.slice(0, -1).map(h => `${h.role}: ${h.parts[0].text}`).join('\n')}
          ---
          MENSAJE: "${userMessageText}"
        `;

        const result = await generateContentWithRetry(model, routerPromptText);
        const action = cleanGeminiJson(result.response.text());
        console.log(`🤖 Acción para ${userName}:`, action);

        let responseText = "";

        switch (action.intent) {
            
            case "BORRAR_MEMORIA":
                clearHistory(numeroCompleto); 
                responseText = "¡Listo! Memoria borrada.";
                await client.sendMessage(msg.from, responseText);
                break; 

            case "LISTA_AGREGAR":
                await ListaModel.updateOne({ numero: msg.from, nombre: action.nombreLista }, { $push: { items: action.item } }, { upsert: true });
                responseText = `"${action.item}" añadido a "${action.nombreLista}".`;
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
            case "LISTA_VER":
                const lista = await ListaModel.findOne({ numero: msg.from, nombre: action.nombreLista });
                if (lista && lista.items && lista.items.length > 0) {
                    responseText = `📝 Lista "${action.nombreLista}":\n${lista.items.map((it, i) => `${i + 1}. ${it}`).join('\n')}`;
                } else { responseText = `Tu lista "${action.nombreLista}" está vacía.`; }
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
            case "LISTA_BORRAR_ITEM":
                await ListaModel.updateOne({ numero: msg.from, nombre: action.nombreLista }, { $pull: { items: action.item } });
                responseText = `"${action.item}" borrado de "${action.nombreLista}".`;
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
            case "LISTA_ELIMINAR":
                await ListaModel.deleteOne({ numero: msg.from, nombre: action.nombreLista });
                responseText = `Lista "${action.nombreLista}" eliminada.`;
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
            case "LISTAS_VER_TODAS":
                const todas = await ListaModel.distinct("nombre", { numero: msg.from });
                responseText = todas.length > 0 ? `Tus listas:\n- ${todas.join('\n- ')}` : "No tienes listas.";
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;

            // --- Recordatorios CORREGIDO (Creación) ---
            case "RECUERDA_CREAR":
                const que = action.que;
                const cuando = action.cuando;
                
                if (!que || !cuando) {
                    responseText = "Necesito saber *qué* recordar y *cuándo*.";
                    await client.sendMessage(msg.from, responseText);
                    break;
                }

                // Parsear fecha sin strings raros de UTC
                const fechaParseada = chrono.es.parse(cuando, new Date(), { forwardDate: true });
                
                if (!fechaParseada || fechaParseada.length === 0) {
                    responseText = `No entendí la fecha: "${cuando}".`;
                } else {
                    const isRecurring = /todos los dias|cada dia|diario|cada (lunes|martes|miércoles|jueves|viernes|sábado|domingo)|semanalmente|cada semana|siempre/i.test(cuando);
                    let responses = [];
                    
                    for (const result of fechaParseada) {
                        const fecha = result.start.date();
                        
                        // --- CORRECCIÓN ZONA HORARIA ---
                        // Chrono devuelve hora UTC basada en el texto. Si usuario dice "8am", es "08:00 UTC".
                        // "08:00 UTC" = "02:00 AM Mexico".
                        // Queremos "08:00 AM Mexico" = "14:00 UTC".
                        // Sumamos 6 horas.
                        fecha.setHours(fecha.getHours() + 6);

                        // Texto de la regla para recurrencia
                        const reglaTexto = isRecurring ? cuando : null;

                        await RecordatorioModel.create({
                            numero: msg.from,
                            texto: que,
                            fecha: fecha,
                            enviado: false,
                            isRecurring: isRecurring,
                            recurrenceRuleText: reglaTexto 
                        });
                        
                        responses.push(`"${que}" el ${fecha.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'medium', timeStyle: 'short' })}`);
                    }
                    
                    responseText = `¡Anotado! ${responses.join('\n')} ${isRecurring ? '(Recurrente)' : ''}`;
                }
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;

            case "RECUERDA_VER":
                const pendientes = await RecordatorioModel.find({ numero: msg.from, enviado: false }).sort({ fecha: 1 });
                if (pendientes.length === 0) {
                    responseText = "No tienes recordatorios pendientes.";
                } else {
                    const listaRec = pendientes.map((r, i) => {
                        const f = r.fecha.toLocaleString('es-MX', { timeZone: 'America/Mexico_City', dateStyle: 'full', timeStyle: 'short' });
                        return `${i + 1}. "${r.texto}"\n    └─ ${f} ${r.isRecurring ? '(recurrente)' : ''}`;
                    }).join('\n\n');
                    responseText = `Pendientes:\n${listaRec}`;
                }
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;
            
            case "RECUERDA_ELIMINAR":
                const qBorrar = action.que;
                if (!qBorrar) { await client.sendMessage(msg.from, "¿Qué borro?"); break; }
                
                if (qBorrar.toLowerCase() === 'todos') {
                    await RecordatorioModel.deleteMany({ numero: msg.from });
                    responseText = "Todos los recordatorios borrados.";
                } else {
                    const del = await RecordatorioModel.deleteMany({ numero: msg.from, texto: { $regex: qBorrar, $options: 'i' } });
                    responseText = `Borrados ${del.deletedCount} recordatorios de "${qBorrar}".`;
                }
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;

            case "CHAT":
            default:
                const chatModelToUse = isUser1 ? liraChatModel : luisChatModel;
                const userHistory = getHistory(numeroCompleto);
                
                const chat = chatModelToUse.startChat({
                    history: userHistory.slice(0, -1),
                   });
                
                const chatResult = await sendChatWithRetry(chat, userMessageText);
                responseText = chatResult.response.text();
                
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
        }

    } catch (error) {
        console.error("❌ Error procesando mensaje:", error);
    }
});

// --- Inicio del Servidor ---
async function startServer() {
    try {
        console.log("Conectando a MongoDB...");
        await mongoose.connect(MONGO_URI, { dbName: dbName });
        console.log("✅ Conectado a MongoDB");

        console.log("Iniciando WhatsApp...");
        await client.initialize();

        console.log("⏰ Iniciando tickers...");
        await checkProactiveMessage(); 
        await checkReminders();
        setInterval(backgroundTicker, 60000); 

        app.listen(port, () => {
            console.log(`🚀 Servidor corriendo en puerto ${port}`);
        });

    } catch (error) {
        console.error("❌ Error fatal:", error);
        process.exit(1);
    }
}

process.on('SIGINT', async () => {
    await mongoose.connection.close();
    if (client) await client.destroy();
    process.exit(0);
});

startServer();