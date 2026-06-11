import { useEffect, useRef, useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import * as ImagePicker from 'expo-image-picker';
import { MaterialIcons } from '@expo/vector-icons';
import {
  Alert,
  ActivityIndicator,
  Animated,
  Easing,
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { defaultLocale, t } from './localization';
import { extractAndAssess, crossCheck, assessUrl } from './utils/foundryService';
import { analyzeUrls, analyzeUrl } from './utils/linkAnalyzer';
import { checkUrlSafeBrowsing } from './utils/safeBrowsing';

export default function App() {
  const [selectedImages, setSelectedImages] = useState([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [screen, setScreen] = useState('home');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [inputTab, setInputTab] = useState('screenshot');
  const [linkInput, setLinkInput] = useState('');
  const [locale, setLocale] = useState(defaultLocale);
  const pulseAnim = useRef(new Animated.Value(0)).current;
  // Home screen animations
  const sonar1 = useRef(new Animated.Value(0)).current;
  const sonar2 = useRef(new Animated.Value(0)).current;
  const sonar3 = useRef(new Animated.Value(0)).current;
  const entranceAnim = useRef(new Animated.Value(0)).current;
  const floatAnim = useRef(new Animated.Value(0)).current;

  // Start home-screen animations (sonar rings, entrance, floating shield)
  useEffect(() => {
    if (screen !== 'home') return;

    const makeSonar = (val) =>
      Animated.loop(
        Animated.timing(val, {
          toValue: 1,
          duration: 2600,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        })
      );

    const s1 = makeSonar(sonar1);
    s1.start();
    const t2 = setTimeout(() => makeSonar(sonar2).start(), 870);
    const t3 = setTimeout(() => makeSonar(sonar3).start(), 1740);

    entranceAnim.setValue(0);
    Animated.timing(entranceAnim, {
      toValue: 1,
      duration: 650,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, { toValue: 1, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(floatAnim, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    ).start();

    return () => {
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [screen, sonar1, sonar2, sonar3, entranceAnim, floatAnim]);

  useEffect(() => {
    if (screen !== 'result') {
      pulseAnim.setValue(0);
      return;
    }

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1400,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 1400,
          easing: Easing.in(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    ).start();
  }, [screen, pulseAnim]);

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

  // Verdict (safe/careful/scam) -> ekrandaki durum metni
  const verdictToStatus = (verdict, locale) => {
    if (locale === 'tr') {
      if (verdict === 'scam') return 'Yüksek Risk';
      if (verdict === 'safe') return 'Düşük Risk';
      return 'Orta Risk';
    }
    if (verdict === 'scam') return 'High Risk';
    if (verdict === 'safe') return 'Low Risk';
    return 'Medium Risk';
  };

  // Real analysis: Gemini extraction + independent assessment,
  // algorithmic link check, then Gemini cross-check.
  const buildScreenshotAnalysis = async (imageUris, locale) => {
    // LAYER 1: Gemini extracts everything from the image + makes its own assessment
    const extracted = await extractAndAssess(imageUris, locale);

    // LAYER 2: The algorithm scans the extracted links mathematically
    const linkAnalysis = analyzeUrls(extracted.urls, extracted.detectedBrand, locale);

    // LAYER 3: Gemini confirms the algorithm's findings and produces the final verdict
    let crossChecked;
    try {
      crossChecked = await crossCheck(extracted, linkAnalysis.findings, locale);
    } catch (e) {
      // If the cross-check call fails, fall back to Gemini's initial assessment
      crossChecked = {
        finalVerdict: extracted.aiVerdict,
        finalRiskScore: extracted.aiRiskScore,
        threatSignals: extracted.aiReasons,
        positiveSignals: [],
        recommendation: '',
      };
    }

    // Split the extracted text into lines (internal use — not shown on screen)
    const extractedLines = (extracted.extractedText || '')
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    // Risk score: take the highest risk of the algorithm and the AI (safer side)
    const riskScore = Math.min(
      100,
      Math.max(crossChecked.finalRiskScore || 0, linkAnalysis.maxRisk || 0)
    );

    // Threats and positive findings are kept SEPARATE
    const threatSignals = (crossChecked.threatSignals || []).filter(Boolean);
    const positiveSignals = (crossChecked.positiveSignals || []).filter(Boolean);

    return {
      // extractedLines is no longer shown on screen but kept internally
      extractedLines,
      // systemFindings = the algorithm's technical findings
      systemFindings: linkAnalysis.findings,
      // indicators = SADECE tehditler
      indicators: threatSignals,
      // positives = positive findings (new field)
      positives: positiveSignals,
      riskScore,
      status: verdictToStatus(crossChecked.finalVerdict, locale),
      confidence: Math.min(99, 70 + (threatSignals.length + positiveSignals.length) * 4),
      aiVerdict: crossChecked.finalVerdict,
      aiReasons: threatSignals.length ? threatSignals : positiveSignals,
      recommendation: crossChecked.recommendation,
    };
  };

  const buildUrlAnalysis = async (urlString, locale) => {
    // LAYER 1: Gemini identifies which brand (if any) this domain impersonates,
    // and gives an independent verdict. Gemini knows real brands -> no manual list.
    let ai;
    try {
      ai = await assessUrl(urlString, locale);
    } catch (e) {
      ai = {
        impersonatedBrand: '',
        isOfficialDomain: false,
        aiVerdict: 'careful',
        aiRiskScore: 40,
        threatSignals: [],
        positiveSignals: [],
        recommendation: '',
      };
    }

    // LAYER 2: The algorithm runs the deterministic checks, now using the real brand
    // Gemini detected (so typosquatting like facebok.com vs facebook.com is caught).
    const single = analyzeUrl(urlString, ai.impersonatedBrand || '', locale);

    // LAYER 4 (Safe Browsing): ask Google's threat database whether this URL is a
    // known malware/phishing site. This does NOT visit the link. If it is listed,
    // that is a strong, authoritative danger signal that overrides "unknown".
    let safeBrowsing = { checked: false, listed: false, signals: [], threatTypes: [] };
    try {
      safeBrowsing = await checkUrlSafeBrowsing(urlString, locale);
    } catch (e) {
      safeBrowsing = { checked: false, listed: false, signals: [], threatTypes: [] };
    }

    // If Gemini does not confidently recognize the domain, do NOT claim it is safe.
    // Be honest: we could not get a clear result. Only the algorithm's findings stand.
    // BUT if Safe Browsing lists it as a known threat, it is NOT "unknown" — it's dangerous.
    const notRecognized =
      ai.recognized === false && ai.aiVerdict === 'unknown' && !safeBrowsing.listed;

    // System (algorithm) findings shown separately from AI reasoning.
    // Safe Browsing findings are added here as authoritative technical findings.
    const algoFindings = [...single.signals, ...safeBrowsing.signals];
    const systemFindings = algoFindings.length
      ? algoFindings
      : [
          locale === 'tr'
            ? 'Algoritma belirgin teknik tehlike işareti bulamadı.'
            : 'The algorithm found no obvious technical red flags.',
        ];

    // Threats = AI threat signals + algorithm signals + Safe Browsing signals (negatives only)
    const indicators = [...(ai.threatSignals || []), ...algoFindings].filter(Boolean);

    if (notRecognized) {
      // Domain not confidently recognized AND not on a threat list. Be honest:
      // show a clear "could not assess" message instead of a fake "safe" verdict.
      // Risk is driven ONLY by the algorithm; the AI verdict is "unknown".
      const riskScore = Math.min(100, single.riskPoints || 0);
      return {
        url: urlString,
        urlInsights: [
          locale === 'tr' ? `Barındırıcı: ${single.host}` : `Host: ${single.host}`,
          locale === 'tr' ? 'Bu alan adı güvenle tanınmadı.' : 'This domain was not confidently recognized.',
        ],
        systemFindings,
        indicators,
        positives: [],
        riskScore,
        status: t(locale, 'urlNotRecognizedStatus'),
        confidence: 0,
        aiVerdict: 'unknown',
        aiReasons: [t(locale, 'urlNotRecognized')],
        recommendation: '',
        notRecognized: true,
      };
    }

    const positives = (ai.positiveSignals || []).filter(Boolean);

    // Risk score: highest of AI risk and algorithm risk (safer side).
    // If Safe Browsing lists the URL as a known threat, force a very high score —
    // an authoritative database hit outweighs the model's opinion.
    let riskScore = Math.min(100, Math.max(ai.aiRiskScore || 0, single.riskPoints || 0));
    if (safeBrowsing.listed) {
      riskScore = Math.max(riskScore, 95);
    }

    return {
      url: urlString,
      urlInsights: [
        locale === 'tr' ? `Barındırıcı: ${single.host}` : `Host: ${single.host}`,
        ai.impersonatedBrand
          ? (locale === 'tr'
              ? `Taklit edilebilecek marka: ${ai.impersonatedBrand}`
              : `Possible impersonated brand: ${ai.impersonatedBrand}`)
          : (locale === 'tr' ? 'Taklit edilen marka tespit edilmedi.' : 'No impersonated brand detected.'),
      ],
      systemFindings,
      indicators,
      positives,
      riskScore,
      status: locale === 'tr'
        ? (riskScore > 75 ? 'Yüksek Risk' : riskScore > 40 ? 'Orta Risk' : 'Düşük Risk')
        : (riskScore > 75 ? 'High Risk' : riskScore > 40 ? 'Medium Risk' : 'Low Risk'),
      confidence: Math.min(99, 70 + (indicators.length + positives.length) * 4),
      // AI fields (URL mode now uses Gemini too)
      aiVerdict: ai.aiVerdict,
      aiReasons: ai.threatSignals && ai.threatSignals.length ? ai.threatSignals : ai.positiveSignals,
      recommendation: ai.recommendation,
    };
  };

  const createAiEvaluation = (analysis) => {
    // Both screenshot and URL modes now produce a real AI result (aiVerdict, aiReasons).
    // Map them to the fields the result screen expects (aiScore, aiSummary, aiComment).
    if (analysis.aiVerdict) {
      const aiScore = Math.max(0, Math.min(100, Math.round(analysis.riskScore)));
      const reasons = Array.isArray(analysis.aiReasons) ? analysis.aiReasons : [];
      return {
        aiScore,
        aiSummary: reasons.length
          ? reasons.join(' ')
          : (analysis.inputType === 'screenshot'
              ? t(locale, 'aiSummaryScreenshot')
              : t(locale, 'aiSummaryUrl')),
        aiComment: analysis.recommendation ||
          (aiScore > 75
            ? t(locale, 'aiCommentHigh')
            : aiScore > 45
              ? t(locale, 'aiCommentMedium')
              : t(locale, 'aiCommentLow')),
      };
    }

    // Fallback (should rarely happen now): derive score from risk + confidence
    const aiScore = Math.max(0, Math.min(100, Math.round((analysis.riskScore * 0.8) + (analysis.confidence * 0.2))));
    const aiSummary = analysis.inputType === 'screenshot'
      ? t(locale, 'aiSummaryScreenshot')
      : t(locale, 'aiSummaryUrl');

    return {
      aiScore,
      aiSummary,
      aiComment: aiScore > 80
        ? t(locale, 'aiCommentHigh')
        : aiScore > 65
          ? t(locale, 'aiCommentMedium')
          : t(locale, 'aiCommentLow'),
    };
  };

  const analyzeScreenshot = async () => {
    if (inputTab === 'screenshot' && selectedImages.length === 0) {
      return;
    }
    if (inputTab === 'link' && !linkInput.trim()) {
      Alert.alert(t(locale, 'errorTitle'), t(locale, 'invalidUrl'));
      return;
    }

    setIsAnalyzing(true);
    try {
      // Screenshot analysis is now async (real Gemini call) -> await is required
      const baseResult = inputTab === 'screenshot'
        ? await buildScreenshotAnalysis(selectedImages, locale)
        : await buildUrlAnalysis(linkInput, locale);

      const aiEvaluation = createAiEvaluation({ ...baseResult, inputType: inputTab });

      const nextResult = {
        ...baseResult,
        summary: inputTab === 'screenshot'
          ? (baseResult.recommendation || t(locale, 'screenshotAnalysisDetected'))
          : t(locale, 'urlAnalysisComplete').replace('{url}', linkInput),
        selectedCount: selectedImages.length,
        inputType: inputTab,
        ...(inputTab === 'link' ? { url: linkInput } : {}),
        ...aiEvaluation,
      };

      setAnalysisResult(nextResult);
      setScreen('result');
    } catch (error) {
      console.error('analyzeScreenshot error', error);
      // Show a clear message based on the error type
      let msg = t(locale, 'analysisFailed');
      const code = String(error?.message || '');
      if (code === 'NO_API_KEY') {
        msg = locale === 'tr'
          ? 'Gemini API anahtarı bulunamadı. .env dosyasına EXPO_PUBLIC_GEMINI_API_KEY ekleyip uygulamayı yeniden başlat.'
          : 'Gemini API key not found. Add EXPO_PUBLIC_GEMINI_API_KEY to your .env and restart the app.';
      } else if (code.startsWith('GEMINI_HTTP_')) {
        msg = (locale === 'tr' ? 'Gemini API hatası: ' : 'Gemini API error: ') + code.replace('GEMINI_HTTP_', 'HTTP ');
      } else if (code === 'IMAGE_READ_FAILED') {
        msg = locale === 'tr'
          ? 'Görsel okunamadı. expo-file-system kurulu mu kontrol et.'
          : 'Could not read the image. Make sure expo-file-system is installed.';
      }
      Alert.alert(t(locale, 'analysisErrorTitle'), msg);
    } finally {
      setIsAnalyzing(false);
    }
  };

  if (screen === 'result') {
    const result = analysisResult || {
      riskScore: 82,
      status: 'High Risk',
      confidence: 91,
      summary: 'This screenshot contains multiple phishing signals that require verification.',
      indicators: ['Suspicious sender metadata', 'Urgent action request', 'Hidden link structure'],
      selectedCount: selectedImages.length,
    };

    const pulseScale = pulseAnim.interpolate({
      inputRange: [0, 1],
      outputRange: [1, 1.12],
    });

    return (
      <SafeAreaView style={[styles.safeArea, styles.resultSafeArea]}>
        <View style={styles.resultBackground} />
        <ScrollView contentContainerStyle={styles.resultContainer}>
          <View style={styles.resultTopBar}>
            <TouchableOpacity style={styles.backButton} onPress={() => setScreen('home')}>
              <MaterialIcons name="arrow-back-ios" size={18} color="#fff" />
              <Text style={styles.backButtonText}>{t(locale, 'back')}</Text>
            </TouchableOpacity>
            <Animated.View style={[styles.pulseCircle, { transform: [{ scale: pulseScale }] }]} />
          </View>

          <View style={styles.resultHero}>
            <Text style={styles.resultHeroTitle}>{t(locale, 'aiThreatScanResult')}</Text>
            <Text style={styles.resultHeroSubtitle}>
              {result.inputType === 'screenshot'
                ? `${t(locale, 'deepAnalysisCompleteFor')} ${result.selectedCount} ${t(locale, 'screenshotLabel')}${result.inputType === 'screenshot' && result.selectedCount > 1 && locale === 'en' ? 's' : ''}.`
                : `${t(locale, 'securityAnalysisOf')}: ${result.url}`}
            </Text>

            <View style={styles.resultScoreCard}>
              <View style={styles.resultScoreRow}>
                <View>
                  <Text style={styles.metricLabel}>{t(locale, 'overallRiskScore')}</Text>
                  <Animated.Text
                    style={[
                      styles.metricValue,
                      {
                        transform: [
                          {
                            scale: pulseScale.interpolate({
                              inputRange: [0, 1],
                              outputRange: [1, 1.1],
                            }),
                          },
                        ],
                      },
                    ]}
                  >
                    {result.riskScore}
                  </Animated.Text>
                </View>
                <View style={[
                  styles.statusBadge,
                  result.notRecognized
                    ? styles.statusBadgeNeutral
                    : result.riskScore > 75
                      ? styles.statusBadgeHigh
                      : result.riskScore > 40
                        ? styles.statusBadgeMedium
                        : styles.statusBadgeSafe,
                ]}>
                  <Text style={styles.statusBadgeText}>{result.status}</Text>
                </View>
              </View>
              <Text style={styles.metricHint}>{t(locale, 'analysisConfidence')} {result.confidence}%</Text>
            </View>
          </View>

          <View style={styles.resultPanel}>
            <Text style={styles.resultSectionTitle}>{t(locale, 'aiReview')}</Text>
            <Text style={styles.resultSummary}>{result.aiSummary}</Text>
            <View style={styles.aiScoreRow}>
              <Text style={styles.aiScoreLabel}>{t(locale, 'aiThreatScore')}</Text>
              <Text style={[styles.aiScoreValue, result.aiScore > 80 ? styles.aiHighScore : styles.aiMediumScore]}>{result.aiScore}/100</Text>
            </View>
            {result.recommendation ? (
              <Text style={styles.resultSummary}>{result.recommendation}</Text>
            ) : null}
          </View>

          <View style={styles.resultPanel}>
            <Text style={styles.resultSectionTitle}>{t(locale, 'detectedThreats')}</Text>
            {result.indicators && result.indicators.length > 0 ? (
              result.indicators.map((item, index) => (
                <View key={`indicator-${index}`} style={styles.indicatorRow}>
                  <View style={styles.indicatorDot} />
                  <Text style={styles.indicatorText}>{item}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.resultSummary}>{t(locale, 'noThreatsFound')}</Text>
            )}
          </View>

          <View style={styles.resultPanel}>
            <Text style={styles.resultSectionTitle}>{t(locale, 'positiveFindings')}</Text>
            {result.positives && result.positives.length > 0 ? (
              result.positives.map((item, index) => (
                <View key={`positive-${index}`} style={styles.indicatorRow}>
                  <View style={[styles.indicatorDot, { backgroundColor: '#22c55e' }]} />
                  <Text style={styles.indicatorText}>{item}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.resultSummary}>{t(locale, 'noPositivesFound')}</Text>
            )}
          </View>

          <View style={styles.resultPanel}>
            <Text style={styles.resultSectionTitle}>{t(locale, 'systemFindings')}</Text>
            {(result.systemFindings || []).map((item, index) => (
              <View key={`finding-${index}`} style={styles.indicatorRow}>
                <View style={styles.indicatorDotSecondary} />
                <Text style={styles.indicatorText}>{item}</Text>
              </View>
            ))}
            {result.urlInsights && result.urlInsights.length > 0 && (
              <View style={styles.resultTextBlock}>
                <Text style={styles.resultTextBlockTitle}>{t(locale, 'urlInspection')}</Text>
                {result.urlInsights.map((line, index) => (
                  <Text key={`urlinsight-${index}`} style={styles.resultTextLine}>{line}</Text>
                ))}
              </View>
            )}
          </View>

          <TouchableOpacity style={styles.reportButton} onPress={() => setScreen('report')}>
            <MaterialIcons name="description" size={20} color="#fff" />
            <Text style={styles.reportButtonText}>{t(locale, 'viewFullReport')}</Text>
          </TouchableOpacity>

          <View style={styles.resultActionGroup}>
            {result.inputType === 'screenshot' && (
              <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('home')}>
                <Text style={styles.secondaryText}>{t(locale, 'reviewScreenshots')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={[styles.primaryButton, styles.resultPrimaryButton]}
              onPress={() => {
                setScreen('home');
                setAnalysisResult(null);
                setSelectedImages([]);
                setLinkInput('');
              }}
            >
              <Text style={styles.primaryText}>{t(locale, 'startNewScan')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'report') {
    const result = analysisResult || {};
    return (
      <SafeAreaView style={[styles.safeArea, styles.reportSafeArea]}>
        <View style={styles.reportBackground} />
        <ScrollView contentContainerStyle={styles.reportContainer}>
          <View style={styles.reportTopBar}>
            <TouchableOpacity style={styles.backButton} onPress={() => setScreen('result')}>
              <MaterialIcons name="arrow-back-ios" size={18} color="#fff" />
              <Text style={styles.backButtonText}>{t(locale, 'backToResult')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.reportHero}>
            <Text style={styles.reportTitle}>{t(locale, 'detailedThreatReport')}</Text>
            <Text style={styles.reportSubtitle}>
              {result.inputType === 'screenshot' ? t(locale, 'screenshotAnalysis') : `${t(locale, 'urlAnalysisPrefix')}${result.url}`}
            </Text>
          </View>

          <View style={styles.reportPanel}>
            <Text style={styles.reportSectionTitle}>{t(locale, 'riskAssessment')}</Text>
            <View style={styles.reportMetricRow}>
              <Text style={styles.reportMetricLabel}>{t(locale, 'overallRiskScore')}</Text>
              <Text style={styles.reportMetricValue}>{result.riskScore}/100</Text>
            </View>
            <View style={styles.reportMetricRow}>
              <Text style={styles.reportMetricLabel}>{t(locale, 'analysisConfidence')}</Text>
              <Text style={styles.reportMetricValue}>{result.confidence}%</Text>
            </View>
            <View style={styles.reportMetricRow}>
              <Text style={styles.reportMetricLabel}>{t(locale, 'threatLevel')}</Text>
              <Text style={[styles.reportMetricValue, styles.reportThreatHigh]}>{result.status}</Text>
            </View>
          </View>

          <View style={styles.reportPanel}>
            <Text style={styles.reportSectionTitle}>{t(locale, 'aiReview')}</Text>
            <Text style={styles.resultSummary}>{result.aiSummary}</Text>
            <View style={styles.reportMetricRow}>
              <Text style={styles.reportMetricLabel}>{t(locale, 'aiThreatScore')}</Text>
              <Text style={[styles.reportMetricValue, result.aiScore > 80 ? styles.reportThreatHigh : styles.aiMediumScore]}>{result.aiScore}/100</Text>
            </View>
          </View>

          <View style={styles.reportPanel}>
            <Text style={styles.reportSectionTitle}>{t(locale, 'detectedThreats')}</Text>
            {result.indicators && result.indicators.length > 0 ? (
              result.indicators.map((item, index) => (
                <View key={`threat-${index}`} style={styles.threatRow}>
                  <View style={styles.threatIcon}>
                    <MaterialIcons name="warning" size={16} color="#f97316" />
                  </View>
                  <Text style={styles.threatText}>{item}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.resultSummary}>{t(locale, 'noThreatsFound')}</Text>
            )}
          </View>

          <View style={styles.reportPanel}>
            <Text style={styles.reportSectionTitle}>{t(locale, 'positiveFindings')}</Text>
            {result.positives && result.positives.length > 0 ? (
              result.positives.map((item, index) => (
                <View key={`positive-${index}`} style={styles.threatRow}>
                  <View style={styles.threatIcon}>
                    <MaterialIcons name="check-circle" size={16} color="#22c55e" />
                  </View>
                  <Text style={styles.threatText}>{item}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.resultSummary}>{t(locale, 'noPositivesFound')}</Text>
            )}
          </View>

          <View style={styles.reportPanel}>
            <Text style={styles.reportSectionTitle}>{t(locale, 'systemFindings')}</Text>
            {(result.systemFindings || []).map((item, index) => (
              <View key={`system-${index}`} style={styles.threatRow}>
                <View style={styles.threatIcon}>
                  <MaterialIcons name="insights" size={16} color="#60a5fa" />
                </View>
                <Text style={styles.threatText}>{item}</Text>
              </View>
            ))}
            {result.urlInsights && result.urlInsights.length > 0 && (
              <View style={styles.resultTextBlock}>
                <Text style={styles.resultTextBlockTitle}>{t(locale, 'urlInspectionDetails')}</Text>
                {result.urlInsights.map((line, index) => (
                  <Text key={`reporturl-${index}`} style={styles.resultTextLine}>{line}</Text>
                ))}
              </View>
            )}
          </View>

          <View style={styles.reportPanel}>
            <Text style={styles.reportSectionTitle}>{t(locale, 'recommendation')}</Text>
            <View style={styles.recommendationRow}>
              <MaterialIcons name="lightbulb" size={20} color="#22c55e" />
              <Text style={styles.recommendationText}>
                {result.recommendation && result.recommendation.length > 0
                  ? result.recommendation
                  : result.aiComment}
              </Text>
            </View>
          </View>

          <View style={styles.reportActionGroup}>
            <TouchableOpacity style={styles.secondaryButton} onPress={() => setScreen('result')}>
              <MaterialIcons name="share" size={18} color="#4338ca" />
              <Text style={styles.secondaryText}>{t(locale, 'shareReport')}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.primaryButton}>
              <MaterialIcons name="download" size={18} color="#fff" />
              <Text style={styles.primaryText}>{t(locale, 'exportPdf')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  if (screen === 'settings') {
    return (
      <SafeAreaView style={[styles.safeArea, styles.settingsSafeArea]}>
        <ScrollView contentContainerStyle={styles.settingsContainer}>
          <View style={styles.settingHeader}>
            <TouchableOpacity style={styles.backButton} onPress={() => setScreen('home')}>
              <MaterialIcons name="arrow-back-ios" size={18} color="#fff" />
              <Text style={styles.backButtonText}>{t(locale, 'back')}</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.settingsHero}>
            <Text style={styles.settingsTitle}>{t(locale, 'settings')}</Text>
            <Text style={styles.settingsSubtitle}>{t(locale, 'settingsSubtitle')}</Text>
          </View>

          <View style={styles.settingsPanel}>
            <Text style={styles.reportSectionTitle}>{t(locale, 'language')}</Text>
            <TouchableOpacity
              style={[styles.settingsOptionButton, locale === 'en' && styles.settingsOptionActive]}
              onPress={() => setLocale('en')}
            >
              <Text style={styles.settingsOptionText}>English</Text>
              {locale === 'en' && <Text style={styles.settingsSelectedLabel}>{t(locale, 'selected')}</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.settingsOptionButton, locale === 'tr' && styles.settingsOptionActive]}
              onPress={() => setLocale('tr')}
            >
              <Text style={styles.settingsOptionText}>Türkçe</Text>
              {locale === 'tr' && <Text style={styles.settingsSelectedLabel}>{t(locale, 'selected')}</Text>}
            </TouchableOpacity>
          </View>

          <View style={styles.noteCard}>
            <Text style={styles.noteTitle}>{t(locale, 'languageInfoTitle')}</Text>
            <Text style={styles.noteText}>{t(locale, 'languageInfoDescription')}</Text>
          </View>

          <StatusBar style="auto" />
        </ScrollView>
      </SafeAreaView>
    );
  }

  const heroTranslate = entranceAnim.interpolate({ inputRange: [0, 1], outputRange: [24, 0] });
  const shieldFloat = floatAnim.interpolate({ inputRange: [0, 1], outputRange: [0, -9] });
  const sonarStyle = (val) => ({
    transform: [{ scale: val.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1.7] }) }],
    opacity: val.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.45, 0.12, 0] }),
  });

  return (
    <SafeAreaView style={styles.homeSafe}>
      <ScrollView contentContainerStyle={styles.homeContainer} showsVerticalScrollIndicator={false}>
        <View style={styles.homeTopBar}>
          <View style={styles.homeBrandRow}>
            <View style={styles.homeBrandIcon}>
              <MaterialIcons name="verified-user" size={18} color="#0F6E56" />
            </View>
            <Text style={styles.homeBrandText}>{t(locale, 'appTitle')}</Text>
          </View>
          <TouchableOpacity style={styles.homeSettingsButton} onPress={() => setScreen('settings')}>
            <MaterialIcons name="settings" size={20} color="#0F6E56" />
          </TouchableOpacity>
        </View>

        <Animated.View style={[styles.homeHero, { opacity: entranceAnim, transform: [{ translateY: heroTranslate }] }]}>
          <View style={styles.shieldStage}>
            <Animated.View style={[styles.sonarRing, sonarStyle(sonar1)]} />
            <Animated.View style={[styles.sonarRing, sonarStyle(sonar2)]} />
            <Animated.View style={[styles.sonarRing, sonarStyle(sonar3)]} />
            <View style={styles.shieldHaloOuter} />
            <View style={styles.shieldHaloInner} />
            <Animated.View style={[styles.shieldCore, { transform: [{ translateY: shieldFloat }] }]}>
              <MaterialIcons name="shield" size={42} color="#ffffff" />
            </Animated.View>
          </View>

          <Text style={styles.homeHeroTitle}>{t(locale, 'isThisMessageAScam')}</Text>
          <Text style={styles.homeHeroSubtitle}>
            {inputTab === 'screenshot'
              ? t(locale, 'uploadScreenshotAndGetCheck')
              : t(locale, 'enterSuspiciousUrl')}
          </Text>
        </Animated.View>

        {inputTab === 'screenshot' && selectedImages.length > 0 && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.homeThumbsRow}
          >
            {selectedImages.map((uri, index) => (
              <View key={`thumb-${uri}-${index}`} style={styles.homeThumb}>
                <Image source={{ uri, cache: 'force-cache' }} style={styles.homeThumbImage} resizeMode="cover" />
                <TouchableOpacity
                  style={styles.homeThumbRemove}
                  onPress={() => setSelectedImages(selectedImages.filter((u, i) => i !== index))}
                >
                  <MaterialIcons name="close" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
        )}

        {inputTab === 'link' && (
          <View style={styles.homeLinkBox}>
            <Text style={styles.homeLinkLabel}>{t(locale, 'enterUrl')}</Text>
            <TextInput
              style={styles.homeLinkInput}
              placeholder={t(locale, 'urlPlaceholder')}
              placeholderTextColor="#9CB3AC"
              value={linkInput}
              onChangeText={setLinkInput}
              editable={!isAnalyzing}
              autoCapitalize="none"
            />
            <Text style={styles.homeLinkHint}>{t(locale, 'pasteUrlHint')}</Text>
          </View>
        )}

        <View style={styles.homeActions}>
          <TouchableOpacity
            style={styles.homePrimaryButton}
            activeOpacity={0.85}
            onPress={() => {
              if (inputTab === 'link') {
                analyzeScreenshot();
              } else if (selectedImages.length > 0) {
                analyzeScreenshot();
              } else {
                pickFromGallery();
              }
            }}
            disabled={isAnalyzing}
          >
            <MaterialIcons
              name={inputTab === 'link' || selectedImages.length > 0 ? 'radar' : 'photo-camera-back'}
              size={22}
              color="#fff"
            />
            <Text style={styles.homePrimaryText}>
              {inputTab === 'link'
                ? t(locale, 'analyze')
                : selectedImages.length > 0
                  ? t(locale, 'analyze')
                  : t(locale, 'selectScreenshot')}
            </Text>
          </TouchableOpacity>

          <View style={styles.homeSecondaryRow}>
            <TouchableOpacity
              style={[styles.homeSecondaryButton, inputTab === 'screenshot' && styles.homeSecondaryActive]}
              activeOpacity={0.8}
              onPress={() => {
                setInputTab('screenshot');
                setLinkInput('');
                pickFromCamera();
              }}
            >
              <MaterialIcons name="camera-alt" size={18} color="#0F6E56" />
              <Text style={styles.homeSecondaryText}>{t(locale, 'camera')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.homeSecondaryButton, inputTab === 'link' && styles.homeSecondaryActive]}
              activeOpacity={0.8}
              onPress={() => {
                setInputTab(inputTab === 'link' ? 'screenshot' : 'link');
                setSelectedImages([]);
              }}
            >
              <MaterialIcons name="link" size={18} color="#0F6E56" />
              <Text style={styles.homeSecondaryText}>{t(locale, 'enterUrl')}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.homeTrustBadge}>
          <MaterialIcons name="lock" size={13} color="#5F6F6A" />
          <Text style={styles.homeTrustText}>{t(locale, 'designTipText')}</Text>
        </View>

        <StatusBar style="dark" />
      </ScrollView>

      {isAnalyzing && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color="#1D9E75" />
            <Text style={styles.loadingTitle}>{t(locale, 'analyzing')}</Text>
            <Text style={styles.loadingSubtitle}>{t(locale, 'analyzingSubtitle')}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  homeSafe: {
    flex: 1,
    backgroundColor: '#F4FAF8',
  },
  homeContainer: {
    flexGrow: 1,
    paddingHorizontal: 22,
    paddingTop: 8,
    paddingBottom: 28,
  },
  homeTopBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  homeBrandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  homeBrandIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    backgroundColor: '#D8F0E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeBrandText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#0F6E56',
  },
  homeSettingsButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E1F5EE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeHero: {
    alignItems: 'center',
    marginTop: 18,
    marginBottom: 8,
  },
  shieldStage: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  sonarRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#1D9E75',
  },
  shieldHaloOuter: {
    position: 'absolute',
    width: 140,
    height: 140,
    borderRadius: 70,
    backgroundColor: '#D8F0E8',
  },
  shieldHaloInner: {
    position: 'absolute',
    width: 104,
    height: 104,
    borderRadius: 52,
    backgroundColor: '#9FE1CB',
  },
  shieldCore: {
    width: 76,
    height: 76,
    borderRadius: 38,
    backgroundColor: '#1D9E75',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#0F6E56',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 8,
  },
  homeHeroTitle: {
    fontSize: 25,
    fontWeight: '700',
    color: '#0F2922',
    textAlign: 'center',
    marginBottom: 8,
    paddingHorizontal: 10,
  },
  homeHeroSubtitle: {
    fontSize: 14.5,
    color: '#5F6F6A',
    textAlign: 'center',
    lineHeight: 21,
    paddingHorizontal: 18,
  },
  homeThumbsRow: {
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 2,
  },
  homeThumb: {
    width: 76,
    height: 100,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#E1F5EE',
    position: 'relative',
  },
  homeThumbImage: {
    width: '100%',
    height: '100%',
  },
  homeThumbRemove: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(15,41,34,0.7)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  homeLinkBox: {
    marginTop: 18,
    backgroundColor: '#ffffff',
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: '#D8F0E8',
  },
  homeLinkLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F6E56',
    marginBottom: 8,
  },
  homeLinkInput: {
    backgroundColor: '#F4FAF8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#0F2922',
    borderWidth: 1,
    borderColor: '#D8F0E8',
  },
  homeLinkHint: {
    fontSize: 12,
    color: '#5F6F6A',
    marginTop: 8,
  },
  homeActions: {
    marginTop: 26,
  },
  homePrimaryButton: {
    height: 58,
    borderRadius: 18,
    backgroundColor: '#1D9E75',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    shadowColor: '#0F6E56',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 6,
  },
  homePrimaryText: {
    color: '#ffffff',
    fontSize: 16.5,
    fontWeight: '600',
  },
  homeSecondaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  homeSecondaryButton: {
    flex: 1,
    height: 50,
    borderRadius: 16,
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#C7E8DD',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  homeSecondaryActive: {
    backgroundColor: '#E1F5EE',
    borderColor: '#1D9E75',
  },
  homeSecondaryText: {
    color: '#0F6E56',
    fontSize: 14,
    fontWeight: '500',
  },
  homeTrustBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 24,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#EAF4F1',
    borderRadius: 14,
  },
  homeTrustText: {
    fontSize: 11.5,
    color: '#5F6F6A',
    textAlign: 'center',
    flexShrink: 1,
  },
  loadingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 50,
  },
  loadingCard: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    paddingVertical: 28,
    paddingHorizontal: 32,
    alignItems: 'center',
    width: 260,
  },
  loadingTitle: {
    marginTop: 16,
    fontSize: 17,
    fontWeight: '600',
    color: '#1e1b4b',
  },
  loadingSubtitle: {
    marginTop: 6,
    fontSize: 13,
    color: '#64748b',
    textAlign: 'center',
  },
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
  tabsContainer: {
    flexDirection: 'row',
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#e2e8f0',
  },
  tabButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabButtonActive: {
    borderBottomColor: '#4338ca',
  },
  tabText: {
    marginLeft: 6,
    fontSize: 14,
    fontWeight: '600',
    color: '#94a3b8',
  },
  tabTextActive: {
    color: '#4338ca',
    fontWeight: '700',
  },
  linkInputContainer: {
    marginBottom: 20,
  },
  linkLabel: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 10,
  },
  linkInput: {
    width: '100%',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#c7d2fe',
    backgroundColor: '#f8fbff',
    fontSize: 15,
    color: '#111827',
    marginBottom: 10,
  },
  linkHint: {
    fontSize: 12,
    color: '#64748b',
    lineHeight: 18,
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
  analyzeActionButtonDisabled: {
    backgroundColor: '#cbd5e1',
    shadowOpacity: 0.08,
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
  resultSafeArea: {
    backgroundColor: '#050816',
  },
  resultBackground: {
    position: 'absolute',
    top: -120,
    right: -100,
    width: 320,
    height: 320,
    borderRadius: 200,
    backgroundColor: 'rgba(79, 70, 229, 0.14)',
  },
  resultContainer: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  resultTopBar: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 28,
  },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  backButtonText: {
    color: '#fff',
    marginLeft: 6,
    fontWeight: '700',
  },
  pulseCircle: {
    width: 58,
    height: 58,
    borderRadius: 30,
    borderWidth: 1.8,
    borderColor: 'rgba(79, 70, 229, 0.8)',
    backgroundColor: 'rgba(79, 70, 229, 0.12)',
  },
  resultHero: {
    position: 'relative',
    width: '100%',
    padding: 24,
    borderRadius: 28,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 9,
    marginBottom: 20,
  },
  resultHeroTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#eef2ff',
    marginBottom: 10,
  },
  resultHeroSubtitle: {
    fontSize: 15,
    color: '#cbd5e1',
    lineHeight: 24,
    marginBottom: 22,
  },
  resultScoreCard: {
    padding: 18,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  resultScoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  metricLabel: {
    color: '#94a3b8',
    fontSize: 13,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    marginBottom: 6,
  },
  metricValue: {
    fontSize: 54,
    fontWeight: '900',
    color: '#fff',
  },
  metricHint: {
    fontSize: 13,
    color: '#94a3b8',
  },
  statusBadge: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#1d2939',
  },
  statusBadgeDanger: {
    backgroundColor: '#f97316',
  },
  statusBadgeHigh: {
    backgroundColor: '#dc2626',
  },
  statusBadgeMedium: {
    backgroundColor: '#f59e0b',
  },
  statusBadgeSafe: {
    backgroundColor: '#16a34a',
  },
  statusBadgeNeutral: {
    backgroundColor: '#64748b',
  },
  statusBadgeText: {
    color: '#fff',
    fontWeight: '800',
    textTransform: 'uppercase',
    fontSize: 12,
  },
  resultPanel: {
    width: '100%',
    padding: 22,
    borderRadius: 24,
    backgroundColor: '#111827',
    marginBottom: 18,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.08)',
  },
  resultSectionTitle: {
    color: '#cbd5e1',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 12,
  },
  indicatorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  indicatorDot: {
    width: 10,
    height: 10,
    borderRadius: 6,
    backgroundColor: '#22c55e',
    marginRight: 12,
  },
  indicatorDotSecondary: {
    width: 10,
    height: 10,
    borderRadius: 6,
    backgroundColor: '#60a5fa',
    marginRight: 12,
  },
  indicatorText: {
    color: '#e2e8f0',
    fontSize: 15,
    lineHeight: 22,
  },
  resultTextBlock: {
    marginTop: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: 'rgba(79, 70, 229, 0.08)',
  },
  resultTextBlockTitle: {
    color: '#cbd5e1',
    fontSize: 14,
    fontWeight: '700',
    marginBottom: 8,
  },
  resultTextLine: {
    color: '#dbeafe',
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
  },
  aiScoreRow: {
    marginTop: 16,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  aiScoreLabel: {
    color: '#94a3b8',
    fontSize: 13,
  },
  aiScoreValue: {
    fontSize: 18,
    fontWeight: '800',
  },
  aiHighScore: {
    color: '#f97316',
  },
  aiMediumScore: {
    color: '#60a5fa',
  },
  resultSummary: {
    color: '#cbd5e1',
    fontSize: 15,
    lineHeight: 24,
  },
  resultActionGroup: {
    width: '100%',
    marginTop: 8,
    flexDirection: 'column',
    gap: 12,
  },
  resultPrimaryButton: {
    marginTop: 10,
  },
  homeBottomMenu: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 24,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 18,
  },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 20,
    backgroundColor: 'rgba(67, 56, 202, 0.12)',
  },
  menuButtonText: {
    color: '#c7d2fe',
    fontSize: 15,
    fontWeight: '700',
    marginLeft: 10,
  },
  settingsSafeArea: {
    backgroundColor: '#050816',
  },
  settingsContainer: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 40,
  },
  settingHeader: {
    width: '100%',
    marginBottom: 24,
  },
  settingsHero: {
    width: '100%',
    padding: 24,
    borderRadius: 28,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
  },
  settingsTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#eef2ff',
    marginBottom: 8,
  },
  settingsSubtitle: {
    fontSize: 15,
    color: '#cbd5e1',
    lineHeight: 22,
  },
  settingsPanel: {
    width: '100%',
    padding: 22,
    borderRadius: 24,
    backgroundColor: '#111827',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.08)',
  },
  settingsOptionButton: {
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 18,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.04)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  settingsOptionActive: {
    backgroundColor: 'rgba(67, 56, 202, 0.16)',
  },
  settingsOptionText: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
  },
  settingsSelectedLabel: {
    color: '#60a5fa',
    fontSize: 14,
    fontWeight: '700',
  },
  primaryText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryText: {
    color: '#4338ca',
    fontSize: 16,
    fontWeight: '800',
  },
  reportButton: {
    width: '100%',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderRadius: 20,
    backgroundColor: '#0f766e',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 18,
    shadowColor: '#0f766e',
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 6,
  },
  reportButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    marginLeft: 8,
  },
  reportSafeArea: {
    backgroundColor: '#050816',
  },
  reportBackground: {
    position: 'absolute',
    top: -100,
    left: -80,
    width: 280,
    height: 280,
    borderRadius: 180,
    backgroundColor: 'rgba(15, 118, 110, 0.12)',
  },
  reportContainer: {
    flexGrow: 1,
    padding: 24,
    paddingBottom: 40,
    alignItems: 'center',
  },
  reportTopBar: {
    width: '100%',
    marginBottom: 24,
  },
  reportHero: {
    width: '100%',
    padding: 24,
    borderRadius: 28,
    backgroundColor: '#0f172a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    marginBottom: 20,
  },
  reportTitle: {
    fontSize: 28,
    fontWeight: '900',
    color: '#eef2ff',
    marginBottom: 8,
  },
  reportSubtitle: {
    fontSize: 15,
    color: '#cbd5e1',
    lineHeight: 22,
  },
  reportPanel: {
    width: '100%',
    padding: 22,
    borderRadius: 24,
    backgroundColor: '#111827',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(148,163,184,0.08)',
  },
  reportSectionTitle: {
    color: '#cbd5e1',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 14,
  },
  reportMetricRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(148,163,184,0.1)',
  },
  reportMetricLabel: {
    color: '#94a3b8',
    fontSize: 14,
  },
  reportMetricValue: {
    color: '#eef2ff',
    fontSize: 16,
    fontWeight: '700',
  },
  reportThreatHigh: {
    color: '#f97316',
  },
  threatRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  threatIcon: {
    marginRight: 12,
    marginTop: 2,
  },
  threatText: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
    flex: 1,
  },
  recommendationRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  recommendationText: {
    color: '#cbd5e1',
    fontSize: 14,
    lineHeight: 20,
    marginLeft: 10,
    flex: 1,
  },
  reportActionGroup: {
    width: '100%',
    marginTop: 8,
    flexDirection: 'row',
    gap: 12,
  },
});
