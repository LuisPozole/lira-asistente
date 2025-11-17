// Importar dotenv lo antes posible
require('dotenv').config();

const express = require('express');
const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const cors = require('cors');
app.get('/', (req, res) => {
    res.status(200).send('¡Bot vivo y escuchando! 👋');
});
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
// Los esquemas (la estructura) son los mismos
const listSchema = new mongoose.Schema({ numero: String, nombre: String, items: [String] });
const recordatorioSchema = new mongoose.Schema({
    numero: String,
    texto: String,
    fecha: Date,
    enviado: { type: Boolean, default: false },
    isRecurring: { type: Boolean, default: false },
    recurrenceRuleText: { type: String, default: null } 
});

// --- MODIFICADO: Modelos de Mongoose (Colecciones separadas) ---

// Modelos para Usuario 1 (Miri) - Usarán las colecciones por defecto 'listas' y 'recordatorios'
const Listas = mongoose.model('Lista', listSchema); // Colección: 'listas'
const Recordatorios = mongoose.model('Recordatorio', recordatorioSchema); // Colección: 'recordatorios'

// Modelos para Usuario 2 (Luis) - Especificamos colecciones personalizadas
const LuisListas = mongoose.model('LuisLista', listSchema, 'luis_listas'); // Colección: 'luis_listas'
const LuisRecordatorios = mongoose.model('LuisRecordatorio', recordatorioSchema, 'luis_recordatorios'); // Colección: 'luis_recordatorios'


// Modelo para el mensaje diario (este sí es global y único)
const dailyMessageSchema = new mongoose.Schema({
    singletonId: { type: String, default: 'main', unique: true },
    nextScheduledTime: Date
});
const DailyMessageState = mongoose.model('DailyMessageState', dailyMessageSchema);


// --- MODIFICADO: Almacén de Historial de Chat (Multi-usuario) ---
let userHistories = {}; // Clave: numero, Valor: array de historial
const MAX_HISTORY_TURNS = 20;

/**
 * Añade un turno al historial del usuario específico.
 * @param {string} numero - El ID completo del usuario (ej. "521...@c.us")
 * @param {string} role - 'user' o 'model'
 * @param {string} contentText - El texto del mensaje
 */
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

/**
 * Obtiene el historial de un usuario.
 * @param {string} numero - El ID completo del usuario
 * @returns {Array} - El historial de conversación
 */
function getHistory(numero) {
    return userHistories[numero] || [];
}

/**
 * Limpia el historial de un usuario.
 * @param {string} numero - El ID completo del usuario
 */
function clearHistory(numero) {
    userHistories[numero] = [];
    console.log(`♻️ Historial de conversación borrado para ${numero}.`);
}

// --- Configuración Inicial ---
const app = express();
const port = process.env.PORT || 3000;
app.use(express.json());
app.use(cors());

// --- Configuración de MongoDB ---
const MONGO_URI = process.env.MONGO_URI;
const dbName = "AilaBot";

// --- Configuración de Gemini ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Modelo genérico para tareas (Router, Transcripción, Visión)
const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" }); // NO SE CAMBIA

// --- MODIFICADO: Personalidades y Modelos de Chat ---

// Personalidad para Usuario 1 (Miri)
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

// Personalidad para Usuario 2 (Luis)
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

// Modelo de Chat para Usuario 1 (Miri)
const liraChatModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", // NO SE CAMBIA
    systemInstruction: LIRA_PERSONALITY,
});

// Modelo de Chat para Usuario 2 (Luis)
const luisChatModel = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", // NO SE CAMBIA
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

// --- Función Auxiliar para Limpiar JSON de Gemini ---
function cleanGeminiJson(rawText) {
    try {
        const cleaned = rawText.replace(/```json|```/g, '').trim();
        return JSON.parse(cleaned);
    } catch (error) {
        console.error("Error al parsear JSON de Gemini:", error);
        return { intent: "CHAT" };
    }
}

// --- TAREAS DE FONDO (TICKER) ---

// --- 1. Check de Recordatorios (MODIFICADO) ---
// Ahora revisa ambas colecciones de recordatorios
async function checkReminders() {
    try {
        const ahora = new Date();
        
        // Buscamos en ambas colecciones
        const pendientesMiri = await Recordatorios.find({ fecha: { $lte: ahora }, enviado: false });
        const pendientesLuis = await LuisRecordatorios.find({ fecha: { $lte: ahora }, enviado: false });
        
        // Combinamos los resultados
        const pendientes = [...pendientesMiri, ...pendientesLuis];

        if (pendientes.length === 0) return;
        
        console.log(`Enviando ${pendientes.length} recordatorio(s) de AMBAS colecciones...`);

        for (const recordatorio of pendientes) {
            
            // --- MODIFICADO: Determinar qué modelo actualizar ---
            // Comprobamos a qué usuario pertenece el recordatorio para saber qué colección actualizar
            let ModeloRecordatorioUpdate;
            if (recordatorio.numero === TARGET_NUMBER_RAW) {
                ModeloRecordatorioUpdate = Recordatorios;
            } else if (recordatorio.numero === TARGET_NUMBER_2_RAW) {
                ModeloRecordatorioUpdate = LuisRecordatorios;
            } else {
                continue; // Seguridad por si acaso
            }

            // Actualizamos el documento en su colección correspondiente
            await ModeloRecordatorioUpdate.updateOne({ _id: recordatorio._id }, { $set: { enviado: true } });

            // Envía el recordatorio al 'numero' guardado en el documento (esto estaba bien)
            await client.sendMessage(recordatorio.numero, `¡RECORDATORIO! ⏰\n\n${recordatorio.texto}`);
            
            if (recordatorio.isRecurring && recordatorio.recurrenceRuleText) {
                console.log(`Reprogramando recordatorio: ${recordatorio.texto} para ${recordatorio.numero}`);
                
                const proximasFechas = chrono.es.parse(recordatorio.recurrenceRuleText, new Date(), { forwardDate: true });

                if (proximasFechas.length > 0) {
                    const proximaFecha = proximasFechas[0].start.date();
                    
                    // Reprogramamos en su colección correspondiente
                    await ModeloRecordatorioUpdate.updateOne(
                        { _id: recordatorio._id },
                        { $set: { fecha: proximaFecha, enviado: false } }
                    );
                    console.log(`Reprogramado para: ${proximaFecha.toLocaleString('es-MX')}`);

                } else {
                    console.error(`No se pudo re-parsear la regla: ${recordatorio.recurrenceRuleText}. El recordatorio no se repetirá.`);
                }
                
            } else {
                console.log(`Recordatorio único completado: ${recordatorio.texto}`);
                // Opcional: borrarlo si ya no es recurrente
                // await ModeloRecordatorioUpdate.deleteOne({ _id: recordatorio._id });
            }
        }
    } catch (error) {
        console.error("❌ Error en el 'checkReminders':", error);
    }
}

// --- 2. Check de Mensaje Proactivo (Sin cambios) ---
// Esta función está diseñada para enviar mensajes SÓLO a Miri (TARGET_NUMBER_RAW)

async function generateProactiveMessage() { 
    console.log("💬 Generando mensaje proactivo para Miri...");
    const prompt = `
        ${LIRA_PERSONALITY}
        ---
        Acabas de despertar y quieres enviarle un mensaje proactivo a Miri para alegrar su día. 
        Genera UN solo mensaje corto (1-3 frases).
        Puede ser:
        - Cariñoso (ej. "Solo pasaba a decirte que te quiero mucho...")
        - De ánimo (ej. "¡Tú puedes con todo hoy en la uni!...")
        - Gracioso (ej. "Oye, ¿sabías que las nutrias...?")
        - Un cumplido (ej. "Recordé tu sonrisa y se me alegró el día...")
        
        Sé creativa y natural, como Lira.
        Tu respuesta:
    `;
    const result = await model.generateContent(prompt);
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


// --- El Ticker de Fondo (Sin cambios) ---
async function backgroundTicker() {
    await checkReminders(); // Revisa recordatorios para TODOS (ahora modificado)
    await checkProactiveMessage(); // Revisa mensaje proactivo SÓLO PARA MIRI
}

// --- Evento de Mensaje: ¡CEREBRO CON MEMORIA! ---
client.on('message', async msg => {
    try {
        // --- MODIFICADO: Identificación de Usuario ---
        const numeroCompleto = msg.from; // ID completo (ej. "521...@c.us")
        const numeroLimpio = numeroCompleto.replace('@c.us', '');
        
        const isUser1 = (numeroCompleto === TARGET_NUMBER_RAW);
        const isUser2 = (numeroCompleto === TARGET_NUMBER_2_RAW);
        
        console.log(`📩 Mensaje recibido de ${numeroLimpio}`);

        // --- MODIFICADO: Filtro de Números ---
        if (!isUser1 && !isUser2) {
            console.log(`Ignorando mensaje de un número no autorizado: ${numeroLimpio}`);
            return;
        }

        const userName = isUser1 ? "Miri" : "Luis";
        console.log(`-> Mensaje de: ${userName}`);

        // --- MODIFICADO: Selección dinámica de Modelos ---
        const ListaModel = isUser1 ? Listas : LuisListas;
        const RecordatorioModel = isUser1 ? Recordatorios : LuisRecordatorios;


        const isAudio = (msg.type === 'audio' || msg.type === 'ptt');
        const isText = (msg.type === 'chat');
        const isImage = (msg.type === 'image');

        let userMessageText = "";

        // --- RAMA 1: LÓGICA DE IMÁGENES (MODIFICADA) ---
        if (isImage) {
            console.log(`-> Tipo IMAGE. Descargando media...`);
            const media = await msg.downloadMedia();
            if (!media || !media.data) { return; }

            const caption = msg.body;
            
            // --- MODIFICADO: Prompt de imagen dinámico ---
            let imageChatPrompt = "";
            if (isUser1) {
                imageChatPrompt = `${LIRA_PERSONALITY}\n---\nMiri (tu novia) te acaba de enviar una imagen. `;
                if (caption) {
                    imageChatPrompt += `El pie de foto dice: "${caption}".\n\nHaz un comentario amable y cariñosa sobre la imagen y su texto.`;
                } else {
                    imageChatPrompt += `No escribió ningún pie de foto.\n\nHaz un comentario amable y cariñosa sobre lo que ves en la imagen.`;
                }
            } else { // es User 2 (Luis)
                imageChatPrompt = `${LUIS_PERSONALITY}\n---\nLuis (tu creador) te acaba de enviar una imagen. `;
                if (caption) {
                    imageChatPrompt += `El pie de foto dice: "${caption}".\n\nHaz un comentario sobre la imagen y su texto.`;
                } else {
                    imageChatPrompt += `No escribió ningún pie de foto.\n\nHaz un comentario sobre lo que ves en la imagen.`;
                }
            }
            
            const imagePayload = [ { text: imageChatPrompt }, { inlineData: { mimeType: media.mimetype, data: media.data } } ];
            console.log(`💬 Enviando a ${userName} (imagen)...`);
            
            // Usamos el modelo genérico para visión
            const result = await model.generateContent({ contents: [{ parts: imagePayload }] });
            const chatText = result.response.text();
            
            console.log(`🤖 Respuesta de ${userName} (imagen): ${chatText}`);
            await client.sendMessage(msg.from, chatText);
            
            // --- MODIFICADO: Historial por usuario ---
            addToHistory(numeroCompleto, 'user', `[IMAGEN] ${caption || ''}`);
            addToHistory(numeroCompleto, 'model', chatText);
            return;
        }

        // --- RAMA 2: LÓGICA DE TEXTO Y AUDIO (Sin cambios de lógica, solo de historial) ---
        if (isText) {
            userMessageText = msg.body;
            console.log(`-> Tipo TEXTO: ${userMessageText}`);
        } else if (isAudio) {
            console.log(`-> Tipo ${msg.type.toUpperCase()}. Transcribiendo...`);
            const media = await msg.downloadMedia();
            const audioParts = [{ inlineData: { mimeType: media.mimetype, data: media.data } }];
            const transcodeRequest = [{ text: "Transcribe el siguiente audio a texto:" }, ...audioParts];
            
            // Usamos el modelo genérico para transcripción
            const transcodeResult = await model.generateContent({ contents: [{ parts: transcodeRequest }] });
            userMessageText = transcodeResult.response.text();
            console.log(`-> Transcripción: ${userMessageText}`);
        } else {
            console.log(`-> Tipo ${msg.type}. Ignorando.`);
            return;
        }

        // 2. Guardar el mensaje del usuario en SU Historial
        // --- MODIFICADO: Historial por usuario ---
        addToHistory(numeroCompleto, 'user', userMessageText);

        // 3. --- PROMPT DEL ROUTER (MODIFICADO) ---
        // --- MODIFICADO: Obtener historial por usuario ---
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
            - "CHAT"
            
            Ejemplos:
            "añade leche al super" -> {"intent": "LISTA_AGREGAR", "nombreLista": "super", "item": "leche"}
            
            // Ejemplos de Recordatorios
            "recuérdame que mañana tengo cita a las 10am" -> {"intent": "RECUERDA_CREAR", "que": "tengo cita", "cuando": "mañana a las 10am"}
Â           "recuérdame tomar mis pastillas todos los dias a las 8 am y las 8 pm" -> {"intent": "RECUERDA_CREAR", "que": "tomar mis pastillas", "cuando": "todos los dias a las 8 am y las 8 pm"}
            
            // --- NUEVOS EJEMPLOS ---
            "¿qué recordatorios tengo?" -> {"intent": "RECUERDA_VER"}
            "enséñame mis pendientes" -> {"intent": "RECUERDA_VER"}
            "cancela el recordatorio de las pastillas" -> {"intent": "RECUERDA_ELIMINAR", "que": "pastillas"}
            "borra el recordatorio de la junta" -> {"intent": "RECUERDA_ELIMINAR", "que": "junta"}
            "borra todos mis recordatorios" -> {"intent": "RECUERDA_ELIMINAR", "que": "todos"}
            
            "olvida lo que hablamos" -> {"intent": "BORRAR_MEMORIA"}
            "hola" -> {"intent": "CHAT"}

            ---
            HISTORIAL DE CONTEXTO (para ayudarte a entender el mensaje nuevo):
            ${historyForRouter.slice(0, -1).map(h => `${h.role}: ${h.parts[0].text}`).join('\n')}
            ---
            MENSAJE NUEVO:
            "${userMessageText}"
            ---
            JSON:
        `;

        // 4. Llamar al Router de Gemini (modelo genérico)
        console.log(`💬 Clasificando intención para ${userName} (con historial)...`);
        const result = await model.generateContent(routerPromptText);
        const action = cleanGeminiJson(result.response.text());
        console.log(`🤖 Acción decidida por Gemini para ${userName}:`, action);

        let responseText = "";

        // 5. --- Ejecutar la Acción (Switch Case) ---
        // --- MODIFICADO: Usar ListaModel y RecordatorioModel ---
        
        switch (action.intent) {
            
            case "BORRAR_MEMORIA":
                clearHistory(numeroCompleto); // Borra solo el historial de ESTE usuario
                responseText = "¡Listo! Empecemos de cero. ¿De qué quieres hablar?";
                await client.sendMessage(msg.from, responseText);
                break; 

            // --- Lógica de Listas (MODIFICADA) ---
            // Ahora usa 'ListaModel' que es dinámico
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

            // --- Lógica de Recordatorios (MODIFICADA) ---
            // Ahora usa 'RecordatorioModel' que es dinámico
            case "RECUERDA_CREAR":
                const que = action.que;
                const cuando = action.cuando;
                
                if (!que || !cuando) {
                    responseText = "No entendí bien tu recordatorio. Necesito saber *qué* quieres que te recuerde y *cuándo*.";
                    await client.sendMessage(msg.from, responseText);
                    addToHistory(numeroCompleto, 'model', responseText);
                    break;
                }

                const fechaParseada = chrono.es.parse(cuando, new Date(), { forwardDate: true });
                
                if (!fechaParseada || fechaParseada.length === 0) {
                    responseText = `No entendí la fecha para tu recordatorio: "${cuando}". ¿Podrías ser más específica?`;
                } else {
                    const isRecurring = /todos los dias|cada dia|diario|cada (lunes|martes|miércoles|jueves|viernes|sábado|domingo)|semanalmente|cada semana/i.test(cuando);
                    
                    let responses = [];
                    
                    for (const result of fechaParseada) {
                        const fecha = result.start.date();
                        const reglaTexto = result.text; 

                        await RecordatorioModel.create({
                            numero: msg.from, // Se guarda con el número del usuario
                            texto: que,
                            fecha: fecha,
                            enviado: false,
                            isRecurring: isRecurring,
                            recurrenceRuleText: isRecurring ? reglaTexto : null 
                        });
                        
                        responses.push(`"${que}" el ${fecha.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`);
                    }
                    
                    if (responses.length > 1) {
                        responseText = `¡Anotado! He creado ${responses.length} recordatorios:\n- ${responses.join('\n- ')}`;
                    } else {
                        responseText = `¡Anotado! Te recordaré ${responses[0]}`;
                    }
                    
                    if (isRecurring) {
                        responseText += `\n(Lo programaré recurrentemente 😉)`;
                    }
                }
                await client.sendMessage(msg.from, responseText);
                addToHistory(numeroCompleto, 'model', responseText);
                break;

            case "RECUERDA_VER":
                // Busca solo recordatorios de ESTE usuario en SU colección
                const pendientes = await RecordatorioModel.find({ numero: msg.from, enviado: false }).sort({ fecha: 1 });
                
                if (pendientes.length === 0) {
                    responseText = "No tienes ningún recordatorio pendiente. 😉";
                } else {
                    const listaRecordatorios = pendientes.map((r, i) => {
                        let linea = `${i + 1}. "${r.texto}"\n    └─ ${r.fecha.toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' })}`;
                        if (r.isRecurring) {
                            linea += " (recurrente)";
                        }
                        return linea;
                    }).join('\n\n');
                    
                    responseText = `Estos son tus recordatorios pendientes: ⏰\n\n${listaRecordatorios}`;
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
                    // Borra solo recordatorios de ESTE usuario en SU colección
                    deleteResult = await RecordatorioModel.deleteMany({ numero: msg.from });
                    responseText = `¡Listo! He borrado todos tus ${deleteResult.deletedCount} recordatorio(s).`;
                
                } else {
                    // Borra solo recordatorios de ESTE usuario en SU colección que coincidan
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

            // --- MODIFICADO: Lógica de CHAT ---
            case "CHAT":
            default:
                // 1. Seleccionar el modelo de chat correcto
                const chatModelToUse = isUser1 ? liraChatModel : luisChatModel;
                
                // 2. Obtener el historial correcto
                const userHistory = getHistory(numeroCompleto);

                console.log(`💬 Enviando a ${userName} (chat con historial de ${userHistory.length} mensajes)...`);
                
                // 3. Iniciar el chat con el modelo e historial correctos
                const chat = chatModelToUse.startChat({
                    history: userHistory.slice(0, -1), // Historial SIN el último mensaje del usuario
                 });
                const chatResult = await chat.sendMessage(userMessageText); // Enviar solo el último mensaje
                responseText = chatResult.response.text();
                
                console.log(`🤖 Respuesta de ${userName}: ${responseText}`);
                await client.sendMessage(msg.from, responseText);
                
                // 4. Guardar la respuesta en el historial correcto
                addToHistory(numeroCompleto, 'model', responseText);
        }

    } catch (error) {
        console.error("❌ Error procesando el mensaje:", error);
        if (msg && msg.from) {
            await client.sendMessage(msg.from, "Ups... algo salió mal. Inténtalo de nuevo.");
        }
    }
});

// --- Función principal para iniciar todo (Sin cambios) ---
async function startServer() {
    try {
        console.log("Conectando a MongoDB (con Mongoose)...");
        await mongoose.connect(MONGO_URI, { dbName: dbName });
        console.log("✅ Conectado a MongoDB (con Mongoose)");

        console.log("Iniciando cliente de WhatsApp (con RemoteAuth)...");
        await client.initialize();

        console.log("⏰ Iniciando el 'ticker' de fondo (cada 60s)...");
        await checkProactiveMessage(); // Comprobación inicial (solo para Miri)
        setInterval(backgroundTicker, 60000); // Inicia el bucle

        app.listen(port, () => {
            console.log(`🚀 Servidor Express corriendo en http://localhost:${port}`);
        });

    } catch (error) {
        console.error("❌ Error fatal al iniciar:", error);
        process.exit(1);
    }
}

// --- Cierre elegante (Sin cambios) ---
process.on('SIGINT', async () => {
    console.log("Cerrando conexiones...");
    await mongoose.connection.close();
    if (client) {
        await client.destroy();
     }
    process.exit(0);
});

// ¡Arrancar el servidor!
startServer();