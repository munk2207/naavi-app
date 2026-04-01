/**
 * Internationalisation — English / Canadian French
 *
 * All user-facing strings live here.
 * Never hardcode text directly in components.
 *
 * Canadian French note: we use "tu" (informal) for Naavi's voice,
 * matching the warm but direct tone of the English version.
 * Medical and health terms use standard Canadian French vocabulary.
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const resources = {
  en: {
    translation: {
      // App shell
      appName: 'MyNaavi',
      tagline: 'Your life, orchestrated.',

      // Home screen
      home: {
        greeting_morning: 'Good morning.',
        greeting_afternoon: 'Good afternoon.',
        greeting_evening: 'Good evening.',
        briefTitle: "Today's brief",
        noBriefItems: 'Nothing urgent today.',
        loadingBrief: 'Preparing your brief…',
        inputPlaceholder: 'Type or speak to MyNaavi…',
        send: 'Send',
        holdToSpeak: 'Hold to speak',
        listening: 'Listening…',
        thinking: 'Thinking…',
      },

      // Brief item categories
      category: {
        calendar: 'Calendar',
        health: 'Health',
        weather: 'Weather',
        social: 'People',
        home: 'Home',
        task: 'Task',
      },

      // Actions
      actions: {
        reminderSet: 'Reminder set for {{datetime}}',
        draftReady: 'Message draft ready — tap to review',
        profileUpdated: 'Got it.',
      },

      // Settings
      settings: {
        title: 'Settings',
        language: 'Language',
        languageEn: 'English',
        languageFr: 'Français',
        connected: 'Connected tools',
        calendar: 'Calendar',
        health: 'Health portal',
        smartHome: 'Smart home',
        connected_status: 'Connected',
        disconnected_status: 'Not connected',
        briefTime: 'Morning brief time',
        responseLength: 'Response detail',
        brief_short: 'Brief',
        brief_detailed: 'Detailed',
        version: 'Version {{version}}',
      },

      // Errors
      errors: {
        noConnection: 'No connection — using last sync.',
        apiError: 'Something went wrong. Please try again.',
        micPermission: 'Microphone access is needed for voice.',
      },
    },
  },

  fr: {
    translation: {
      appName: 'MyNaavi',
      tagline: 'Ta vie, orchestrée.',

      home: {
        greeting_morning: 'Bonjour.',
        greeting_afternoon: 'Bon après-midi.',
        greeting_evening: 'Bonsoir.',
        briefTitle: "Le résumé d'aujourd'hui",
        noBriefItems: "Rien d'urgent aujourd'hui.",
        loadingBrief: 'Préparation de ton résumé…',
        inputPlaceholder: 'Écris ou parle à MyNaavi…',
        send: 'Envoyer',
        holdToSpeak: 'Appuie pour parler',
        listening: "Je t'écoute\u2026",
        thinking: 'Je réfléchis…',
      },

      category: {
        calendar: 'Calendrier',
        health: 'Santé',
        weather: 'Météo',
        social: 'Personnes',
        home: 'Maison',
        task: 'Tâche',
      },

      actions: {
        reminderSet: 'Rappel créé pour {{datetime}}',
        draftReady: 'Brouillon prêt — appuie pour réviser',
        profileUpdated: 'Compris.',
      },

      settings: {
        title: 'Paramètres',
        language: 'Langue',
        languageEn: 'English',
        languageFr: 'Français',
        connected: 'Outils connectés',
        calendar: 'Calendrier',
        health: 'Portail de santé',
        smartHome: 'Maison intelligente',
        connected_status: 'Connecté',
        disconnected_status: 'Non connecté',
        briefTime: 'Heure du résumé matinal',
        responseLength: 'Détail des réponses',
        brief_short: 'Court',
        brief_detailed: 'Détaillé',
        version: 'Version {{version}}',
      },

      errors: {
        noConnection: 'Pas de connexion — utilisation de la dernière synchro.',
        apiError: 'Une erreur est survenue. Réessaie.',
        micPermission: "L'accès au micro est nécessaire pour la voix.",
      },
    },
  },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    lng: 'en',           // Default language — updated from device locale on startup
    fallbackLng: 'en',
    interpolation: {
      escapeValue: false, // React handles XSS
    },
  });

export default i18n;
