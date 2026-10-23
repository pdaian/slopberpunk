// Prompts follow the device in use, independently of connected hardware.
// GPL-3.0-or-later. See LICENSE.
import { escapeHtml } from './icons.js';

const bindings = {
  keyboard: { arc:'1',surge:'2',mend:'3',aegis:'4',lance:'5',echo:'6',breach:'7',siphon:'8',execute:'9',nova:'0',interact:'E',target:'Tab',jump:'Space',dash:'Q',sprint:'Shift',medkit:'H',journal:'J',talents:'T',inventory:'I',map:'M',community:'C',guild:'U',dungeons:'G',chat:'Enter',gestures:'B',settings:'Esc',escape:'Esc',camera:'V' },
  gamepad: { arc:'RT',surge:'LB',mend:'RB',aegis:'LT',lance:'←',echo:'→',breach:'L3+↑',siphon:'L3+→',execute:'L3+↓',nova:'L3+←',interact:'X',target:'Y',jump:'A',dash:'B',sprint:'L3',medkit:'↑',journal:'View',map:'↓',settings:'Menu',escape:'B' },
  touch: { interact:'USE',target:'TARGET',jump:'JUMP',dash:'DASH' },
};

export function controlLabel(action, device = 'keyboard') {
  return bindings[device]?.[action.replace(/^ability:/,'')] || '';
}

export function inputText(device, keyboard, gamepad, touch) {
  return ({keyboard,gamepad,touch})[device] ?? keyboard;
}

// Keep existing nodes and focus when the device changes in an open panel.
export function inputPrompt(keyboard, gamepad, touch) {
  return `<span data-input-keyboard="${escapeHtml(keyboard)}" data-input-gamepad="${escapeHtml(gamepad)}" data-input-touch="${escapeHtml(touch)}">${escapeHtml(keyboard)}</span>`;
}

export function updateInputPrompts(root, device) {
  root.dataset.activeInput=device;
  for (const node of root.querySelectorAll('[data-input-keyboard]')) {
    const text=inputText(device,node.dataset.inputKeyboard,node.dataset.inputGamepad,node.dataset.inputTouch);
    if(node.textContent!==text)node.textContent=text;
    node.hidden=!text;
  }
  for (const node of root.querySelectorAll('[data-input-action]')) {
    const text=controlLabel(node.dataset.inputAction,device);
    if(node.textContent!==text)node.textContent=text;
    node.hidden=!text;
  }
  for (const node of root.querySelectorAll('[data-input-device]')) node.hidden=node.dataset.inputDevice!==device;
}
