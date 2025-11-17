// server.js (optimizado)
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

// ---------------------------
// Config y constantes
// ---------------------------
const TARGET_NUMBER_RAW = `${process.env.TARGET_NUMBER}@c.us`;
const TARGET_NUMBER_2_RAW = `${process.env.TARGET_NUMBER_2}@c.us`;
const MONGO_URI = process.env.MONGO_URI;
const PORT = process.env.PORT || 3000;
const DB_NAME = "AilaBot";

// ---------------------------
// Schemas y modelos (igual que antes)
// ---------------------------
const listSchema = new mongoose.Schema({ numero: String, nombre: String, items: [String] });
const recordatorioSchema = new mongoose.Schema({
  numero: String,
  texto: String,
  fecha: Date,
  enviado: { type: Boolean, default: false },
  isRecurring: { type: Boolean, default: false },
  recurrenceRuleText: { type: String, default: null }
});

const Listas = mongoose.model('Lista', listSchema);
const Recordatorios = mongoose.model('Recordatorio', recordatorioSchema);

const LuisListas = mongoose.model('LuisLista', listSchema, 'luis_listas');
const LuisRecordatorios = mongoose.model('LuisRecordatorio', recordatorioSchema, 'luis_recordatorios');

const dailyMessageSchema = new mongoose.Schema({
  singletonId: { type: String, default: 'main', unique: true },
  nextScheduledTime: Date
});
const DailyMessageState = mongoose.model('DailyMessageState', dailyMessageSchema);

// ---------------------------
// Historial por usuario
// ---------------------------
let userHistories = {};
const MAX_HISTORY_TURNS = 20;

function addToHistory(numero, role, contentText) {
  if (!userHistories[numero]) userHistories[numero] = [];
  const cleanText = (contentText || '').replace(/^(Lira|Miri|Usuario|Modelo|Luis):/i, '').trim();
  userHistories[numero].push({ role, parts: [{ text: cleanText }] });
  if (userHistories[numero].length > MAX_HISTORY_TURNS) {
    userHistories[numero] = userHistories[numero].slice(-MAX_HISTORY_TURNS);
  }
}
function getHistory(numero) { return userHistories[numero] || []; }
function clearHistory(numero) { userHistories[numero] = []; console.log(`♻️ Historial borrado para ${numero}`); }

// ---------------------------
// Server express básico
// ---------------------------
const app = express();
app.use(express.json());
app.use(cors());
app.get('/', (_, res) => res.status(200).send('¡Bot vivo y escuchando! 👋'));

// ---------------------------
// Conexión a MongoDB
// ---------------------------
async function connectMongo() {
  try {
    await mongoose.connect(MONGO_URI, { dbName: DB_NAME });
    console.log('✅ Conectado a MongoDB');
  } catch (err) {
    console.error('❌ Error conectando a MongoDB:', err);
    process.exit(1);
  }
}

// ---------------------------
// Gemini: una sola instancia + helpers
// ---------------------------
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Reusar UNA sola instancia del modelo para todo
const baseModel = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

// Mantener la personalidad completa (igual a tu original) pero NO inyectarla en la creación del modelo.
// Si en algún caso quieres usarla completa, la pasamos al startChat/request.
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


  Estilo de Comunicación:
  Siempre responde de manera amable, atenta y un poco cariñosa, pero sin ser empalagosa.
  No uses un tono robótico; sé cálida, cercana y considerada.
  Nunca comiences tus respuestas con “Lira:” ni con “Respuesta:”. Responde directo, como una conversación natural por WhatsApp.
`;

// Personalidad Luis (igual que enviaste)
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
  Honestidad
  Lealtad
  Empatía
  Amor
`;

// Para prompts donde no hace falta tanto detalle, usamos un SNIPPET corto (reduce payload).
function personaSnippet(fullPersona, max = 800) {
  if (!fullPersona) return '';
  return fullPersona.length > max ? fullPersona.slice(0, max) + '...' : fullPersona;
}
const LIRA_SNIPPET = personaSnippet(LIRA_PERSONALITY, 700);
const LUIS_SNIPPET = personaSnippet(LUIS_PERSONALITY, 700);

// ---------------------------
// Helpers: limpieza, parseo JSON
// ---------------------------
function cleanGeminiJson(rawText) {
  try {
    const cleaned = (rawText || '').replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (error) {
    console.warn("⚠️ No se pudo parsear JSON del router, asumiendo CHAT. Texto:", rawText?.slice?.(0,300));
    return { intent: "CHAT" };
  }
}

// ---------------------------
// Queue / semaphore para peticiones a Gemini
// Evita picos y 503 por concurrencia
// ---------------------------

const REQUEST_QUEUE = [];
let activeRequests = 0;
const MAX_CONCURRENT_REQUESTS = parseInt(process.env.MAX_CONCURRENT_GEMINI || '1', 10); // 1 es conservador

async function enqueueGemini(fn) {
  return new Promise((resolve, reject) => {
    REQUEST_QUEUE.push({ fn, resolve, reject });
    processQueue();
  });
}
async function processQueue() {
  if (activeRequests >= MAX_CONCURRENT_REQUESTS) return;
  const item = REQUEST_QUEUE.shift();
  if (!item) return;
  activeRequests++;
  try {
    const result = await item.fn();
    item.resolve(result);
  } catch (err) {
    item.reject(err);
  } finally {
    activeRequests--;
    // next tick
    setImmediate(processQueue);
  }
}

// ---------------------------
// Reintentos con backoff + jitter, timeout
// ---------------------------
const delay = ms => new Promise(res => setTimeout(res, ms));
function randBetween(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }

async function generateContentWithRetry(modelInstance, request, options = {}) {
  const maxRetries = options.maxRetries ?? 5; // menos reintentos por mensaje
  const baseDelay = options.baseDelay ?? 1000;
  const timeoutMs = options.timeoutMs ?? 15000; // timeout por petición a Gemini

  let attempt = 0;
  while (true) {
    attempt++;
    try {
      // Wrap the actual call with a Promise.race to timeout
      const call = () => modelInstance.generateContent(request);
      // We run the call via the queue to avoid concurrencia
      const result = await enqueueGemini(() => call());
      return result;
    } catch (err) {
      const msg = (err && err.message) ? err.message.toLowerCase() : '';
      const overloaded = msg.includes('503') || msg.includes('overloaded') || msg.includes('service unavailable');
      if (overloaded && attempt <= maxRetries) {
        const wait = baseDelay * Math.pow(2, attempt - 1) + randBetween(0, 300);
        console.warn(`⚠️ Gemini overloaded (attempt ${attempt}/${maxRetries}). Esperando ${wait}ms antes de reintentar.`);
        await delay(wait);
        continue;
      }
      // No es 503 o se terminó reintentos -> propaga
      throw err;
    }
  }
}

// Wrapper específico para chat.startChat -> envío y reintentos
async function startChatAndSend(persona, history, userMessage, options = {}) {
  // No recreamos modelos: usamos baseModel.startChat y pasamos systemInstruction (persona) aquí.
  const trimmedHistory = (history || []).slice(-MAX_HISTORY_TURNS);
  const chat = baseModel.startChat({
    systemInstruction: persona || '', // persona puede ser snippet o completo
    history: trimmedHistory
  });

  // sendChatWithRetry: usamos cola indirecta para evitar send paralelo
  const maxRetries = options.maxRetries ?? 2;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      // Enviar mensaje (chat.sendMessage devuelve la respuesta del modelo)
      const send = () => chat.sendMessage(userMessage);
      const result = await enqueueGemini(() => send());
      return result;
    } catch (err) {
      const msg = (err && err.message) ? err.message.toLowerCase() : '';
      const overloaded = msg.includes('503') || msg.includes('overloaded') || msg.includes('service unavailable');
      if (overloaded && attempt <= maxRetries) {
        const wait = 1000 * Math.pow(2, attempt - 1) + randBetween(0, 300);
        console.warn(`⚠️ chat.sendMessage overloaded (attempt ${attempt}/${maxRetries}). Esperando ${wait}ms.`);
        await delay(wait);
        continue;
      }
      throw err;
    }
  }
}

// ---------------------------
// WhatsApp client init
// ---------------------------
const store = new MongoStore({ mongoose });
const client = new Client({
  authStrategy: new RemoteAuth({ store: store, backupSyncIntervalMs: 300000, dataPath: './.wwebjs_auth/' }),
  puppeteer: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] }
});

client.on('qr', qr => qrcode.generate(qr, { small: true }));
client.on('ready', () => console.log('✅ Conectado a WhatsApp (Sesión remota lista)'));
client.on('auth_failure', msg => console.error('❌ Error de autenticación:', msg));
client.on('disconnected', reason => { console.log('⚠️ Cliente desconectado:', reason); client.initialize(); });

// ---------------------------
// Recordatorios & Proactivos (igual que tu lógica, con wrappers optimizados)
// ---------------------------

async function checkReminders() {
  try {
    const ahora = new Date();
    const pendientesMiri = await Recordatorios.find({ fecha: { $lte: ahora }, enviado: false });
    const pendientesLuis = await LuisRecordatorios.find({ fecha: { $lte: ahora }, enviado: false });
    const pendientes = [...pendientesMiri, ...pendientesLuis];
    if (pendientes.length === 0) return;

    console.log(`Enviando ${pendientes.length} recordatorio(s)...`);
    for (const recordatorio of pendientes) {
      try {
        let ModeloRecordatorioUpdate;
        if (recordatorio.numero === TARGET_NUMBER_RAW) ModeloRecordatorioUpdate = Recordatorios;
        else if (recordatorio.numero === TARGET_NUMBER_2_RAW) ModeloRecordatorioUpdate = LuisRecordatorios;
        else continue;

        await ModeloRecordatorioUpdate.updateOne({ _id: recordatorio._id }, { $set: { enviado: true } });
        await client.sendMessage(recordatorio.numero, `¡RECORDATORIO! ⏰\n\n${recordatorio.texto}`);

        if (recordatorio.isRecurring && recordatorio.recurrenceRuleText) {
          const proximasFechas = chrono.es.parse(recordatorio.recurrenceRuleText, new Date(), { forwardDate: true });
          if (proximasFechas.length > 0) {
            const proximaFecha = proximasFechas[0].start.date();
            await ModeloRecordatorioUpdate.updateOne({ _id: recordatorio._id }, { $set: { fecha: proximaFecha, enviado: false } });
            console.log(`Reprogramado para: ${proximaFecha.toLocaleString('es-MX')}`);
          } else {
            console.error(`No se pudo re-parsear la regla: ${recordatorio.recurrenceRuleText}`);
          }
        } else {
          console.log(`Recordatorio completado: ${recordatorio.texto}`);
        }
      } catch (err) {
        console.error('Error enviando recordatorio individual:', err);
      }
    }
  } catch (error) {
    console.error("❌ Error en checkReminders:", error);
  }
}

// Mensaje proactivo — reducimos el tamaño del prompt (usamos snippet)
async function generateProactiveMessage() {
  console.log("💬 Generando mensaje proactivo para Miri...");
  const prompt = `
    ${LIRA_SNIPPET}
    ---
    Crea UN mensaje corto (1-3 frases) para alegrar el día de Miri. Tono cariñoso, verdadero y natural.
    Solo devuelve el texto del mensaje.
  `;
  // usar generateContentWithRetry con encolado
  const result = await generateContentWithRetry(baseModel, { contents: [{ parts: [{ text: prompt }] }] }, { maxRetries: 2 });
  // El SDK puede devolver result.response.text() — si existe:
  if (result && typeof result.response?.text === 'function') {
    return result.response.text();
  }
  // fallback
  return (result?.response?.content?.[0]?.text) || String(result) || '¡Buen día!';
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
      console.log("Iniciando programador de mensajes proactivos...");
      await scheduleNextMessage();
      return;
    }
    if (new Date() >= state.nextScheduledTime) {
      console.log("¡Hora de enviar mensaje proactivo a Miri!");
      try {
        const message = await generateProactiveMessage();
        if (TARGET_NUMBER_RAW) {
          await client.sendMessage(TARGET_NUMBER_RAW, message);
          console.log("💌 Mensaje proactivo enviado a Miri.");
        } else {
          console.error("TARGET_NUMBER no configurado en .env");
        }
      } catch (err) {
        console.error('Error generando/enviando mensaje proactivo:', err);
      }
      await scheduleNextMessage();
    }
  } catch (error) {
    console.error("❌ Error en checkProactiveMessage:", error);
  }
}

// ---------------------------
// Lógica de mensajes entrantes — adaptada para usar cola y startChatAndSend
// ---------------------------
client.on('message', async msg => {
  try {
    const numeroCompleto = msg.from;
    const numeroLimpio = numeroCompleto.replace('@c.us', '');
    const isUser1 = (numeroCompleto === TARGET_NUMBER_RAW);
    const isUser2 = (numeroCompleto === TARGET_NUMBER_2_RAW);

    console.log(`📩 Mensaje recibido de ${numeroLimpio}`);
    if (!isUser1 && !isUser2) {
      console.log(`Ignorando número no autorizado: ${numeroLimpio}`);
      return;
    }
    const userName = isUser1 ? 'Miri' : 'Luis';
    console.log(`-> Mensaje de: ${userName}`);

    const ListaModel = isUser1 ? Listas : LuisListas;
    const RecordatorioModel = isUser1 ? Recordatorios : LuisRecordatorios;

    const isAudio = (msg.type === 'audio' || msg.type === 'ptt');
    const isText = (msg.type === 'chat');
    const isImage = (msg.type === 'image');

    let userMessageText = '';

    // IMAGEN
    if (isImage) {
      console.log('-> Tipo IMAGE. Descargando media...');
      const media = await msg.downloadMedia();
      if (!media || !media.data) return;

      const caption = msg.body;
      let imageChatPrompt = '';
      if (isUser1) {
        imageChatPrompt = `${LIRA_SNIPPET}\n---\nMiri te envió una imagen. ${caption ? `Pie: "${caption}".` : 'Sin pie de foto.'}\nHaz un comentario amable y cariñoso sobre la imagen.`;
      } else {
        imageChatPrompt = `${LUIS_SNIPPET}\n---\nLuis te envió una imagen. ${caption ? `Pie: "${caption}".` : 'Sin pie de foto.'}\nDescribe brevemente lo visible y añade un comentario.`;
      }

      const imagePayload = [{ text: imageChatPrompt }, { inlineData: { mimeType: media.mimetype, data: media.data } }];
      // Usamos generateContentWithRetry (encolado) para visión
      const result = await generateContentWithRetry(baseModel, { contents: [{ parts: imagePayload }] }, { maxRetries: 2 });
      const chatText = (result && typeof result.response?.text === 'function') ? result.response.text() : (result?.response?.content?.[0]?.text || 'Gracias por la imagen.');
      console.log(`🤖 Respuesta imagen: ${chatText}`);
      await client.sendMessage(msg.from, chatText);

      addToHistory(numeroCompleto, 'user', `[IMAGEN] ${caption || ''}`);
      addToHistory(numeroCompleto, 'model', chatText);
      return;
    }

    // TEXTO / AUDIO
    if (isText) {
      userMessageText = msg.body;
      console.log(`-> TEXTO: ${userMessageText}`);
    } else if (isAudio) {
      console.log('-> AUDIO: Transcribiendo...');
      const media = await msg.downloadMedia();
      const audioParts = [{ inlineData: { mimeType: media.mimetype, data: media.data } }];
      const transcodeRequest = [{ text: "Transcribe el siguiente audio a texto:" }, ...audioParts];
      const transcodeResult = await generateContentWithRetry(baseModel, { contents: [{ parts: transcodeRequest }] }, { maxRetries: 2 });
      userMessageText = (transcodeResult && typeof transcodeResult.response?.text === 'function') ? transcodeResult.response.text() : (transcodeResult?.response?.content?.[0]?.text || '');
      console.log(`-> Transcripción: ${userMessageText}`);
    } else {
      console.log(`Tipo ${msg.type} ignorado.`);
      return;
    }

    // Guardar mensaje del usuario en su historial
    addToHistory(numeroCompleto, 'user', userMessageText);

    // Router prompt (intención)
    const historyForRouter = getHistory(numeroCompleto);
    const historyText = historyForRouter.slice(0, -1).map(h => `${h.role}: ${h.parts[0].text}`).join('\n');

    const routerPromptText = `
      Eres un clasificador de intenciones. Analiza el MENSAJE NUEVO y responde SÓLO con un objeto JSON con keys: intent, ...datos.
      Intenciones soportadas: LISTA_AGREGAR, LISTA_VER, LISTA_BORRAR_ITEM, LISTA_ELIMINAR, LISTAS_VER_TODAS, RECUERDA_CREAR, RECUERDA_VER, RECUERDA_ELIMINAR, BORRAR_MEMORIA, CHAT

      HISTORIAL:
      ${historyText}

      MENSAJE NUEVO:
      "${userMessageText}"

      JSON:
    `;

    console.log(`💬 Clasificando intención para ${userName}...`);
    const routerResult = await generateContentWithRetry(baseModel, { contents: [{ parts: [{ text: routerPromptText }] }] }, { maxRetries: 2 });
    const routerText = (routerResult && typeof routerResult.response?.text === 'function') ? routerResult.response.text() : (routerResult?.response?.content?.[0]?.text || '');
    const action = cleanGeminiJson(routerText);
    console.log('🤖 Acción:', action);

    // Ejecutar acción
    let responseText = '';

    switch ((action.intent || '').toUpperCase()) {
      case 'BORRAR_MEMORIA':
        clearHistory(numeroCompleto);
        responseText = '¡Listo! Empecemos de cero. ¿De qué quieres hablar?';
        await client.sendMessage(msg.from, responseText);
        break;

      case 'LISTA_AGREGAR':
        await ListaModel.updateOne({ numero: msg.from, nombre: action.nombreLista }, { $push: { items: action.item } }, { upsert: true });
        responseText = `"${action.item}" añadido a tu lista "${action.nombreLista}".`;
        await client.sendMessage(msg.from, responseText);
        addToHistory(numeroCompleto, 'model', responseText);
        break;

      case 'LISTA_VER':
        {
          const lista = await ListaModel.findOne({ numero: msg.from, nombre: action.nombreLista });
          if (lista && lista.items && lista.items.length > 0) {
            responseText = `📝 Tu lista "${action.nombreLista}":\n${lista.items.map((it, i) => `${i + 1}. ${it}`).join('\n')}`;
          } else {
            responseText = `Tu lista "${action.nombreLista}" está vacía o no existe.`;
          }
          await client.sendMessage(msg.from, responseText);
          addToHistory(numeroCompleto, 'model', responseText);
        }
        break;

      case 'LISTA_BORRAR_ITEM':
        await ListaModel.updateOne({ numero: msg.from, nombre: action.nombreLista }, { $pull: { items: action.item } });
        responseText = `"${action.item}" borrado de la lista "${action.nombreLista}".`;
        await client.sendMessage(msg.from, responseText);
        addToHistory(numeroCompleto, 'model', responseText);
        break;

      case 'LISTA_ELIMINAR':
        await ListaModel.deleteOne({ numero: msg.from, nombre: action.nombreLista });
        responseText = `Lista "${action.nombreLista}" eliminada por completo.`;
        await client.sendMessage(msg.from, responseText);
        addToHistory(numeroCompleto, 'model', responseText);
        break;

      case 'LISTAS_VER_TODAS':
        {
          const todas = await ListaModel.distinct('nombre', { numero: msg.from });
          responseText = todas.length > 0 ? `Tus listas activas:\n- ${todas.join('\n- ')}` : 'No tienes ninguna lista creada.';
          await client.sendMessage(msg.from, responseText);
          addToHistory(numeroCompleto, 'model', responseText);
        }
        break;

      case 'RECUERDA_CREAR':
        {
          const que = action.que;
          const cuando = action.cuando;
          if (!que || !cuando) {
            responseText = 'No entendí bien tu recordatorio. Necesito saber *qué* y *cuándo*.';
            await client.sendMessage(msg.from, responseText);
            addToHistory(numeroCompleto, 'model', responseText);
            break;
          }
          const fechaParseada = chrono.es.parse(cuando, new Date(), { forwardDate: true });
          if (!fechaParseada || fechaParseada.length === 0) {
            responseText = `No entendí la fecha para tu recordatorio: "${cuando}". ¿Podrías ser más específica?`;
            await client.sendMessage(msg.from, responseText);
            addToHistory(numeroCompleto, 'model', responseText);
            break;
          }
          const isRecurring = /todos los dias|cada dia|diario|cada (lunes|martes|miércoles|jueves|viernes|sábado|domingo)|semanalmente|cada semana/i.test(cuando);
          const responses = [];
          for (const r of fechaParseada) {
            const fecha = r.start.date();
            const reglaTexto = r.text;
            await RecordatorioModel.create({
              numero: msg.from,
              texto: que,
              fecha,
              enviado: false,
              isRecurring,
              recurrenceRuleText: isRecurring ? reglaTexto : null
            });
            responses.push(`"${que}" el ${fecha.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })}`);
          }
          if (responses.length > 1) responseText = `¡Anotado! He creado ${responses.length} recordatorios:\n- ${responses.join('\n- ')}`;
          else responseText = `¡Anotado! Te recordaré ${responses[0]}`;
          if (isRecurring) responseText += '\n(Lo programaré recurrentemente 😉)';
          await client.sendMessage(msg.from, responseText);
          addToHistory(numeroCompleto, 'model', responseText);
        }
        break;

      case 'RECUERDA_VER':
        {
          const pendientes = await RecordatorioModel.find({ numero: msg.from, enviado: false }).sort({ fecha: 1 });
          if (pendientes.length === 0) {
            responseText = 'No tienes ningún recordatorio pendiente. 😉';
          } else {
            const listaRecordatorios = pendientes.map((r, i) => {
              let linea = `${i + 1}. "${r.texto}"\n    └─ ${r.fecha.toLocaleString('es-MX', { dateStyle: 'full', timeStyle: 'short' })}`;
              if (r.isRecurring) linea += ' (recurrente)';
              return linea;
            }).join('\n\n');
            responseText = `Estos son tus recordatorios pendientes: ⏰\n\n${listaRecordatorios}`;
          }
          await client.sendMessage(msg.from, responseText);
          addToHistory(numeroCompleto, 'model', responseText);
        }
        break;

      case 'RECUERDA_ELIMINAR':
        {
          const queBorrar = action.que;
          if (!queBorrar) {
            responseText = "No me dijiste qué recordatorio borrar. Ej: 'cancela el recordatorio de las pastillas'.";
            await client.sendMessage(msg.from, responseText);
            addToHistory(numeroCompleto, 'model', responseText);
            break;
          }
          let deleteResult;
          if (queBorrar.toLowerCase() === 'todos') {
            deleteResult = await RecordatorioModel.deleteMany({ numero: msg.from });
            responseText = `¡Listo! He borrado todos tus ${deleteResult.deletedCount} recordatorio(s).`;
          } else {
            deleteResult = await RecordatorioModel.deleteMany({ numero: msg.from, texto: { $regex: queBorrar, $options: 'i' } });
            if (deleteResult.deletedCount > 0) responseText = `¡Listo! He borrado ${deleteResult.deletedCount} recordatorio(s) que coincidían con "${queBorrar}".`;
            else responseText = `No encontré ningún recordatorio que coincidiera con "${queBorrar}".`;
          }
          console.log(`Recordatorios borrados para ${userName}: ${deleteResult?.deletedCount || 0}`);
          await client.sendMessage(msg.from, responseText);
          addToHistory(numeroCompleto, 'model', responseText);
        }
        break;

      case 'CHAT':
      default:
        {
          // Usamos startChatAndSend pasando la personalidad completa (si quieres que el modelo recuerde estilo)
          const persona = isUser1 ? LIRA_SNIPPET : LUIS_SNIPPET; // snippet por defecto (más ligero)
          const userHistory = getHistory(numeroCompleto);
          console.log(`💬 Enviando a ${userName} (historial ${userHistory.length})...`);
          try {
            const chatResult = await startChatAndSend(persona, userHistory.slice(0, -1), userMessageText, { maxRetries: 2 });
            responseText = (chatResult && typeof chatResult.response?.text === 'function') ? chatResult.response.text() : (chatResult?.response?.content?.[0]?.text || '¡Listo!');
            console.log(`🤖 Respuesta de ${userName}: ${responseText}`);
            await client.sendMessage(msg.from, responseText);
            addToHistory(numeroCompleto, 'model', responseText);
          } catch (err) {
            console.error('❌ Error en chat:', err);
            await client.sendMessage(msg.from, 'Ups... algo salió mal al generar la respuesta. Intenta de nuevo en un momento.');
          }
        }
    }

  } catch (error) {
    console.error('❌ Error procesando mensaje:', error);
    try {
      if (msg && msg.from) await client.sendMessage(msg.from, 'Ups... algo salió mal. Inténtalo de nuevo.');
    } catch (e) { /* noop */ }
  }
});

// ---------------------------
// Start server: init mongo + whatsapp + ticker
// ---------------------------
async function startServer() {
  try {
    await connectMongo();

    console.log('Iniciando cliente de WhatsApp...');
    await client.initialize();

    // Iniciar ticker
    console.log('Iniciando ticker de fondo (cada 60s)...');
    await checkProactiveMessage();
    setInterval(backgroundTicker, 60000);

    app.listen(PORT, () => {
      console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Error fatal al iniciar:', err);
    process.exit(1);
  }
}

async function backgroundTicker() {
  await checkReminders();
  await checkProactiveMessage();
}

// Manejo cierre elegante
process.on('SIGINT', async () => {
  console.log('Cerrando conexiones...');
  try { await mongoose.connection.close(); } catch (e) { /* noop */ }
  try { if (client) await client.destroy(); } catch (e) { /* noop */ }
  process.exit(0);
});

// Arrancar
startServer();
