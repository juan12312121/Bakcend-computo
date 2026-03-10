require('dotenv').config();

console.log('\n🧪 TEST DIRECTO DE CENSURA MANUAL\n');

const { censurarManualmente } = require('./src/config/gemini');

// Test 1: Palabra simple
console.log('TEST 1: "pendejo"');
const resultado1 = censurarManualmente('pendejo');
console.log('Resultado:', JSON.stringify(resultado1, null, 2));

// Test 2: Con contexto de objetivo
console.log('\nTEST 2: "eres un pendejo"');
const resultado2 = censurarManualmente('eres un pendejo');
console.log('Resultado:', JSON.stringify(resultado2, null, 2));

// Test 3: Sin objetivo
console.log('\nTEST 3: "qué pedo"');
const resultado3 = censurarManualmente('qué pedo');
console.log('Resultado:', JSON.stringify(resultado3, null, 2));

console.log('\n✅ Tests completados\n');