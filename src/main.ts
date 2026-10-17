import { createApp } from 'vue'
import App from './App.vue'
import './style.css'

// 兼容旧书签，管理页面仍由独立入口加载。
if (location.hash === '#admin') location.replace('/admin/')
else createApp(App).mount('#app')
