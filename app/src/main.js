import { mount } from 'svelte';
import './styles/fonts.css';
import './styles/app.css';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app') });

// Container-v1 plan files (see planfile.js) prepend a static front door as a
// fallback for when the app fails to boot — remove it now that it hasn't.
document.getElementById('openfirst-front-door')?.remove();

export default app;
