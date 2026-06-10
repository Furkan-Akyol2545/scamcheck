const strings = {
  en: {
    appTitle: 'ScamCheck',
    selectScreenshot: 'Select Screenshot',
    analyze: 'Analyze',
    analyzingPlaceholder: 'Analyzing...',
    noScreenshot: 'No screenshot selected yet.',
    allowCameraRoll: 'Please allow access to your photos so you can select a screenshot.',
    screenshotSelected: 'Screenshot selected:',
    imagesSelected: 'image(s) selected.',
    noImageFound: 'No image could be loaded from the picker result.',
    pickerError: 'Image picker error occurred.',
  },
};

export function t(locale, key) {
  return strings[locale]?.[key] ?? strings.en[key] ?? key;
}

export const defaultLocale = 'en';
