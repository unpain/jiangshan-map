import { mount, unmount } from 'svelte';
import App from './App.svelte';
import 'leaflet/dist/leaflet.css';
import '../style.css';

const target = document.getElementById('app');
if (!target) throw new Error('Missing application container');
target.replaceChildren();
export const app = mount(App, {target});

// Entry replacement must not leave an earlier Leaflet instance behind.
if (import.meta.hot) import.meta.hot.dispose(() => { void unmount(app); });
