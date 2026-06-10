import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Alert,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { defaultLocale, t } from './localization';

export default function App() {
  const [selectedImages, setSelectedImages] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const locale = defaultLocale;

  const normalizePickerResult = (pickerResult) => {
    if (!pickerResult) return [];

    const assets = Array.isArray(pickerResult.assets)
      ? pickerResult.assets
      : Array.isArray(pickerResult.selected)
      ? pickerResult.selected
      : pickerResult.uri
      ? [{ uri: pickerResult.uri }]
      : [];

    const uris = assets
      .map((asset) => asset?.uri)
      .filter((uri) => typeof uri === 'string' && uri.length > 0);

    return uris;
  };

  const pickFromGallery = async () => {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (permissionResult.status !== 'granted' && permissionResult.granted !== true) {
        Alert.alert(t(locale, 'appTitle'), t(locale, 'allowCameraRoll'));
        return;
      }

      const mediaTypesValue = ImagePicker.MediaType?.images || 'images';
      const pickerResult = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: [mediaTypesValue],
        allowsEditing: false,
        allowsMultipleSelection: true,
        quality: 0.8,
      });

      const imageUris = normalizePickerResult(pickerResult);
      if (imageUris.length === 0) {
        Alert.alert(t(locale, 'appTitle'), t(locale, 'noImageFound'));
        return;
      }

      setSelectedImages((current) => [...current, ...imageUris]);
    } catch (error) {
      console.error('pickFromGallery error', error);
      Alert.alert(t(locale, 'appTitle'), `${t(locale, 'pickerError')}\n${String(error)}`);
    }
  };

  const pickFromCamera = async () => {
    try {
      const permissionResult = await ImagePicker.requestCameraPermissionsAsync();
      if (permissionResult.status !== 'granted' && permissionResult.granted !== true) {
        Alert.alert(t(locale, 'appTitle'), t(locale, 'allowCameraRoll'));
        return;
      }

      const pickerResult = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });

      const imageUris = normalizePickerResult(pickerResult);
      if (imageUris.length === 0) {
        Alert.alert(t(locale, 'appTitle'), t(locale, 'noImageFound'));
        return;
      }

      setSelectedImages((current) => [...current, ...imageUris]);
    } catch (error) {
      console.error('pickFromCamera error', error);
      Alert.alert(t(locale, 'appTitle'), `${t(locale, 'pickerError')}\n${String(error)}`);
    }
  };

  const analyzeScreenshot = () => {
    if (selectedImages.length === 0) {
      return;
    }

    setIsAnalyzing(true);
    const message = `${t(locale, 'analyzingPlaceholder')}\n\n${t(
      locale,
      'screenshotSelected'
    )} ${selectedImages.length} ${t(locale, 'imagesSelected')}`;
    Alert.alert(t(locale, 'analyze'), message);
    setIsAnalyzing(false);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.headerCard}>
          <View style={styles.brandRow}>
            <View style={styles.brandIcon}>
              <MaterialIcons name="shield" size={22} color="#fff" />
            </View>
            <Text style={styles.title}>{t(locale, 'appTitle')}</Text>
          </View>
          <Text style={styles.subtitle}>
            Protect your inbox and brand trust by evaluating suspicious screenshots before you tap.
          </Text>
        </View>

        <View style={styles.selectCard}>
          <View style={styles.selectLabel}>
            <MaterialIcons name="help-outline" size={18} color="#475569" />
            <Text style={styles.selectLabelText}>Is this message a scam?</Text>
          </View>
          <Text style={styles.selectTitle}>Upload a screenshot and get an instant safety check.</Text>

          <View style={styles.dropZone}>
            <View style={styles.dropZoneHeader}>
              {selectedImages.length === 0 ? (
                <View style={styles.dropIconCircle}>
                  <MaterialIcons name="image" size={28} color="#4f46e5" />
                </View>
              ) : null}
              <View style={styles.dropZoneText}>
                <Text style={styles.dropTitle}>
                  {selectedImages.length > 0
                    ? `${selectedImages.length} screenshot${selectedImages.length > 1 ? 's' : ''} selected`
                    : 'Select a screenshot'}
                </Text>
                <Text style={styles.dropSubtitleSmall}>
                  {selectedImages.length > 0
                    ? 'Images are ready to analyze.'
                    : 'Email, SMS, or any message'}
                </Text>
              </View>
              <TouchableOpacity style={styles.addMoreButton} onPress={pickFromGallery}>
                <MaterialIcons name="add" size={20} color="#4338ca" />
              </TouchableOpacity>
            </View>

            {selectedImages.length > 0 && (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.selectedThumbsRow}
              >
                {selectedImages.map((uri, index) => (
                  <View key={`thumb-${uri}-${index}`} style={styles.selectedThumb}>
                    <Image source={{ uri, cache: 'force-cache' }} style={styles.selectedThumbImage} resizeMode="cover" />
                    <TouchableOpacity
                      style={styles.thumbRemoveButton}
                      onPress={() => {
                        const next = selectedImages.filter((itemUri, itemIndex) => itemIndex !== index);
                        setSelectedImages(next);
                      }}
                    >
                      <MaterialIcons name="close" size={16} color="#fff" />
                    </TouchableOpacity>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>

          <View style={styles.actionsRow}>
            <TouchableOpacity style={styles.actionButton} onPress={pickFromCamera}>
              <MaterialIcons name="camera-alt" size={18} color="#4338ca" />
              <Text style={styles.actionText}>Camera</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, styles.actionButtonLast]} onPress={pickFromGallery}>
              <MaterialIcons name="folder" size={18} color="#4338ca" />
              <Text style={styles.actionText}>Gallery</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.analyzeActionButton} onPress={analyzeScreenshot}>
            <MaterialIcons name="qr-code-scanner" size={20} color="#fff" style={styles.buttonIcon} />
            <Text style={styles.analyzeActionText}>{t(locale, 'analyze')}</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.noteCard}>
          <Text style={styles.noteTitle}>Design tip</Text>
          <Text style={styles.noteText}>Selected screenshots now appear inside the upload card.</Text>
        </View>

        <StatusBar style="auto" />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#eef2ff',
  },
  container: {
    flexGrow: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 24,
    paddingBottom: 40,
  },
  title: {
    fontSize: 36,
    fontWeight: '900',
    marginBottom: 16,
    color: '#ffffff',
    letterSpacing: 0.5,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  brandIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 14,
  },
  description: {
    fontSize: 16,
    color: '#c7d2fe',
    textAlign: 'left',
    marginTop: 10,
    lineHeight: 24,
  },
  headerCard: {
    width: '100%',
    padding: 24,
    marginBottom: 24,
    borderRadius: 28,
    backgroundColor: '#0f172a',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 32,
    shadowOffset: { width: 0, height: 16 },
    elevation: 8,
  },
  subtitle: {
    marginTop: 14,
    color: '#cbd5e1',
    fontSize: 16,
    lineHeight: 24,
  },
  statusCard: {
    width: '100%',
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    marginBottom: 20,
    shadowColor: '#334155',
    shadowOpacity: 0.08,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 12 },
    elevation: 5,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  statusLabel: {
    color: '#4338ca',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 8,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  statusValue: {
    fontSize: 32,
    fontWeight: '800',
    color: '#1e293b',
  },
  selectCard: {
    width: '100%',
    padding: 20,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    marginBottom: 20,
    shadowColor: '#334155',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },
  selectLabel: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  selectLabelText: {
    color: '#475569',
    marginLeft: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    fontSize: 12,
    fontWeight: '700',
  },
  selectTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#111827',
    marginBottom: 20,
  },
  dropZone: {
    width: '100%',
    padding: 18,
    borderRadius: 22,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#c7d2fe',
    backgroundColor: '#f8fbff',
    marginBottom: 24,
  },
  dropZoneHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dropZoneText: {
    flex: 1,
    marginLeft: 14,
  },
  addMoreButton: {
    width: 38,
    height: 38,
    borderRadius: 12,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#0f172a',
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  dropIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#eef2ff',
    justifyContent: 'center',
    alignItems: 'center',
  },
  dropTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 6,
  },
  dropSubtitle: {
    fontSize: 14,
    color: '#64748b',
    textAlign: 'left',
    lineHeight: 22,
  },
  dropSubtitleSmall: {
    fontSize: 12,
    color: '#64748b',
    textAlign: 'left',
    lineHeight: 18,
  },
  selectedThumbsRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  selectedThumb: {
    width: 120,
    height: 120,
    borderRadius: 20,
    overflow: 'hidden',
    marginRight: 12,
    backgroundColor: '#fff',
  },
  selectedThumbImage: {
    width: '100%',
    height: '100%',
  },
  thumbRemoveButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(17,24,39,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  actionButton: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#f8fbff',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  actionButtonLast: {
    marginRight: 0,
  },
  actionText: {
    marginLeft: 8,
    color: '#4338ca',
    fontWeight: '700',
  },
  analyzeActionButton: {
    width: '100%',
    paddingVertical: 18,
    backgroundColor: '#4338ca',
    borderRadius: 20,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 18,
    shadowColor: '#4338ca',
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
  },
  analyzeActionText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#fff',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  buttonIcon: {
    marginRight: 10,
  },
  previewCard: {
    width: '100%',
    padding: 20,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    shadowColor: '#334155',
    shadowOpacity: 0.08,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 12 },
    elevation: 7,
    marginBottom: 20,
  },
  previewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 18,
  },
  iconLabel: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  iconLabelText: {
    marginLeft: 8,
    fontSize: 13,
    color: '#475569',
    fontWeight: '700',
  },
  previewHint: {
    fontSize: 13,
    color: '#475569',
  },
  previewGrid: {
    paddingVertical: 4,
    paddingHorizontal: 2,
    alignItems: 'center',
  },
  previewItem: {
    width: 170,
    height: 170,
    marginRight: 16,
    borderRadius: 22,
    overflow: 'hidden',
    backgroundColor: '#f8fafc',
  },
  previewImage: {
    width: '100%',
    height: '100%',
    borderRadius: 14,
    backgroundColor: '#e5e7eb',
  },
  deleteButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255, 255, 255, 0.88)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 10,
    shadowColor: '#0f172a',
    shadowOpacity: 0.15,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  deleteButtonText: {
    color: '#fff',
    fontSize: 18,
    lineHeight: 20,
    fontWeight: '800',
  },
  emptyCard: {
    width: '100%',
    padding: 22,
    borderRadius: 22,
    backgroundColor: '#eef2ff',
    alignItems: 'center',
    marginBottom: 20,
    shadowColor: '#334155',
    shadowOpacity: 0.08,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
    elevation: 5,
  },
  emptyText: {
    color: '#4338ca',
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  noteCard: {
    width: '100%',
    padding: 18,
    borderRadius: 22,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    marginTop: 12,
    marginBottom: 24,
    shadowColor: '#334155',
    shadowOpacity: 0.06,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  noteTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
    marginBottom: 8,
  },
  noteText: {
    fontSize: 14,
    color: '#475569',
    lineHeight: 22,
  },
});
