import ExpoModulesCore
import UIKit
import Vision
import CoreImage
#if canImport(onnxruntime_objc)
import onnxruntime_objc
#endif

public class MoodSyncVisionModule: Module {
  private static let inferenceQueue = DispatchQueue(label: "com.moodsync.affectnet.inference", qos: .userInitiated)
  private static let ciContext = CIContext(options: [.useSoftwareRenderer: false])

  #if canImport(onnxruntime_objc)
  private static var ortEnv: ORTEnv?
  private static var ortSession: ORTSession?
  private static var ortInputName: String = "input"
  private static var ortOutputName: String = "output"
  private static var ortInitialized = false
  #endif

  private static let emotionLabelsTr: [String: String] = [
    "happy": "Mutlu",
    "surprise": "Heyecanlı",
    "neutral": "Dingin",
    "sad": "Üzgün",
    "angry": "Kızgın"
  ]

  private static let emotionToMood: [String: String] = [
    "happy": "positive",
    "surprise": "positive",
    "neutral": "neutral",
    "sad": "negative",
    "angry": "negative"
  ]

  public func definition() -> ModuleDefinition {
    Name("MoodSyncVision")

    Function("getEngineInfo") { () -> [String: Any] in
      let hasOnnx = Self.isAffectNetReady()
      return [
        "available": true,
        "engine": hasOnnx ? "affectnet-onnx-ondevice" : "apple-vision",
        "label": hasOnnx
          ? "AffectNet EfficientNet-B2 · Cihaz İçi AI"
          : "Apple Vision · On-Device Yüz Analizi"
      ]
    }

    AsyncFunction("analyzeBase64Frame") { (base64Input: String, isFinalCapture: Bool) -> [String: Any] in
      return Self.inferenceQueue.sync {
        return Self.analyzeImage(base64Input: base64Input, isFinalCapture: isFinalCapture)
      }
    }

    Function("excludeAppDataFromBackup") { () -> Bool in
      let fm = FileManager.default
      guard let docsUrl = fm.urls(for: .documentDirectory, in: .userDomainMask).first else {
        return false
      }
      var targetUrls: [URL] = [
        docsUrl.appendingPathComponent("moodsync_snapshots", isDirectory: true),
        docsUrl.appendingPathComponent("SQLite", isDirectory: true),
        docsUrl.appendingPathComponent("moodsync_client_prefs.json", isDirectory: false)
      ]
      for i in 0..<targetUrls.count {
        if fm.fileExists(atPath: targetUrls[i].path) {
          var values = URLResourceValues()
          values.isExcludedFromBackup = true
          try? targetUrls[i].setResourceValues(values)
        }
      }
      return true
    }

    View(MoodSyncGlassView.self) {
      Prop("glassStyle") { (view: MoodSyncGlassView, style: String) in
        view.setGlassStyle(style)
      }
      Prop("isDark") { (view: MoodSyncGlassView, isDark: Bool) in
        view.setIsDark(isDark)
      }
      Prop("interactive") { (view: MoodSyncGlassView, interactive: Bool) in
        view.setInteractive(interactive)
      }
      Prop("glassTintColor") { (view: MoodSyncGlassView, color: UIColor?) in
        view.setGlassTintColor(color)
      }
      Prop("capsule") { (view: MoodSyncGlassView, capsule: Bool) in
        view.setCapsule(capsule)
      }
      Prop("cornerRadius") { (view: MoodSyncGlassView, radius: CGFloat) in
        view.setCornerRadius(radius)
      }
      Prop("showShadow") { (view: MoodSyncGlassView, show: Bool) in
        view.setShowShadow(show)
      }
    }

    View(MoodSyncLiquidTabBarView.self) {
      Events("onSelectTab")

      Prop("tabs") { (view: MoodSyncLiquidTabBarView, tabs: [[String: Any]]) in
        view.setTabs(tabs)
      }
      Prop("activeTab") { (view: MoodSyncLiquidTabBarView, key: String) in
        view.setActiveTab(key)
      }
      Prop("isDark") { (view: MoodSyncLiquidTabBarView, isDark: Bool) in
        view.setIsDark(isDark)
      }
      Prop("accentColor") { (view: MoodSyncLiquidTabBarView, color: UIColor) in
        view.setAccentColor(color)
      }
    }
  }

  // MARK: - AffectNet ONNX Runtime Loader

  private static func findAffectNetModelPath() -> String? {
    var bundles: [Bundle] = [
      Bundle.main,
      Bundle(for: MoodSyncVisionModule.self)
    ]
    bundles.append(contentsOf: Bundle.allBundles)

    for bundle in bundles {
      if let path = bundle.path(forResource: "affectnet_b2_7", ofType: "onnx") {
        return path
      }
      if let path = bundle.path(forResource: "affectnet_b2_7", ofType: "onnx", inDirectory: "Models") {
        return path
      }
    }
    return nil
  }

  private static func isAffectNetReady() -> Bool {
    #if canImport(onnxruntime_objc)
    return ensureOnnxSession() != nil
    #else
    return false
    #endif
  }

  #if canImport(onnxruntime_objc)
  private static func ensureOnnxSession() -> ORTSession? {
    if ortInitialized {
      return ortSession
    }
    ortInitialized = true

    guard let modelPath = findAffectNetModelPath() else {
      return nil
    }

    do {
      let env = try ORTEnv(loggingLevel: .warning)
      let options = try ORTSessionOptions()
      try options.setIntraOpNumThreads(4)
      let session = try ORTSession(env: env, modelPath: modelPath, sessionOptions: options)
      let inputs = try session.inputNames()
      let outputs = try session.outputNames()
      if let firstIn = inputs.first {
        ortInputName = firstIn
      }
      if let firstOut = outputs.first {
        ortOutputName = firstOut
      }
      ortEnv = env
      ortSession = session
      return session
    } catch {
      ortSession = nil
      return nil
    }
  }
  #endif

  // MARK: - Main Analysis Pipeline

  private static func analyzeImage(base64Input: String, isFinalCapture: Bool) -> [String: Any] {
    let cleanedBase64: String
    if let commaRange = base64Input.range(of: "base64,") {
      cleanedBase64 = String(base64Input[commaRange.upperBound...])
    } else {
      cleanedBase64 = base64Input
    }

    guard
      let data = Data(base64Encoded: cleanedBase64, options: .ignoreUnknownCharacters),
      let uiImage = UIImage(data: data),
      let normalizedImage = normalizeOrientation(uiImage),
      let cgImage = normalizedImage.cgImage
    else {
      return notDetectedResult(engine: "affectnet-onnx-ondevice")
    }

    // 1. Hardware-accelerated face detection via Apple Vision (~5ms on iPhone 16 Pro)
    let faceRequest = VNDetectFaceRectanglesRequest()
    let handler = VNImageRequestHandler(cgImage: cgImage, orientation: .up, options: [:])
    do {
      try handler.perform([faceRequest])
    } catch {
      return notDetectedResult(engine: "affectnet-onnx-ondevice")
    }

    guard let faces = faceRequest.results, !faces.isEmpty else {
      return notDetectedResult(engine: "affectnet-onnx-ondevice")
    }

    guard let primaryFace = faces.max(by: {
      ($0.boundingBox.width * $0.boundingBox.height) < ($1.boundingBox.width * $1.boundingBox.height)
    }) else {
      return notDetectedResult(engine: "affectnet-onnx-ondevice")
    }

    // Convert Vision normalized bounding box (bottom-left origin) to UI top-left [x1, y1, x2, y2]
    let bbox = primaryFace.boundingBox
    let x1 = max(0.0, min(1.0, Double(bbox.origin.x)))
    let y1 = max(0.0, min(1.0, Double(1.0 - bbox.origin.y - bbox.height)))
    let x2 = max(0.0, min(1.0, Double(bbox.origin.x + bbox.width)))
    let y2 = max(0.0, min(1.0, Double(1.0 - bbox.origin.y)))
    let faceBox: [Double] = [x1, y1, x2, y2]

    // 2. Primary: Run exact AffectNet EfficientNet-B2 7-Emotion ONNX deep learning model on-device
    #if canImport(onnxruntime_objc)
    if let session = ensureOnnxSession(),
       let onnxRes = classifyWithAffectNetONNX(session: session, cgImage: cgImage, faceBoxTopLeft: faceBox) {
      let emotion = onnxRes.emotion
      let mood = emotionToMood[emotion] ?? "neutral"
      return [
        "detected": true,
        "mood": mood,
        "emotion": emotion,
        "emotionLabel": emotionLabelsTr[emotion] ?? "Dingin",
        "confidence": onnxRes.confidence,
        "faceBox": faceBox,
        "engine": "affectnet-onnx-ondevice",
        "serverConnected": true
      ]
    }
    #endif

    // 3. Fallback only if ONNX model is unavailable
    let ciImage = CIImage(cgImage: cgImage)
    let detector = CIDetector(
      ofType: CIDetectorTypeFace,
      context: ciContext,
      options: [CIDetectorAccuracy: isFinalCapture ? CIDetectorAccuracyHigh : CIDetectorAccuracyLow]
    )
    let features = detector?.features(in: ciImage, options: [CIDetectorSmile: true]) as? [CIFaceFeature] ?? []
    let emotion = (features.first?.hasSmile ?? false) ? "happy" : "neutral"
    return [
      "detected": true,
      "mood": emotionToMood[emotion] ?? "neutral",
      "emotion": emotion,
      "emotionLabel": emotionLabelsTr[emotion] ?? "Dingin",
      "confidence": 0.78,
      "faceBox": faceBox,
      "engine": "apple-vision",
      "serverConnected": true
    ]
  }

  private static func notDetectedResult(engine: String) -> [String: Any] {
    return [
      "detected": false,
      "mood": NSNull(),
      "emotion": NSNull(),
      "emotionLabel": NSNull(),
      "confidence": 0.0,
      "faceBox": NSNull(),
      "engine": engine,
      "serverConnected": true
    ]
  }

  // MARK: - AffectNet EfficientNet-B2 7-Emotion Inference (Identical to webapp/detector_service.py)

  #if canImport(onnxruntime_objc)
  private static func classifyWithAffectNetONNX(
    session: ORTSession,
    cgImage: CGImage,
    faceBoxTopLeft: [Double]
  ) -> (emotion: String, confidence: Double)? {
    let imgW = Double(cgImage.width)
    let imgH = Double(cgImage.height)
    let bx1 = faceBoxTopLeft[0] * imgW
    let by1 = faceBoxTopLeft[1] * imgH
    let bx2 = faceBoxTopLeft[2] * imgW
    let by2 = faceBoxTopLeft[3] * imgH
    let bw = max(16.0, bx2 - bx1)
    let bh = max(16.0, by2 - by1)

    // Apple Vision boundingBox covers the tight face; add slight forehead/chin padding to match YOLOv8 + AffectNet crop
    let cx1 = max(0.0, bx1 - bw * 0.04)
    let cy1 = max(0.0, by1 - bh * 0.08)
    let cx2 = min(imgW, bx2 + bw * 0.04)
    let cy2 = min(imgH, by2 + bh * 0.06)
    let cropRect = CGRect(
      x: cx1,
      y: cy1,
      width: max(24.0, cx2 - cx1),
      height: max(24.0, cy2 - cy1)
    )

    guard let cropped = cgImage.cropping(to: cropRect) else {
      return nil
    }

    let size = 260
    guard let tensorData = makeNormalizedCHWData(cgImage: cropped, width: size, height: size) else {
      return nil
    }

    do {
      let inputTensor = try ORTValue(
        tensorData: tensorData,
        elementType: .float,
        shape: [1, 3, NSNumber(value: size), NSNumber(value: size)]
      )

      let outputs = try session.run(
        withInputs: [ortInputName: inputTensor],
        outputNames: Set([ortOutputName]),
        runOptions: nil
      )

      guard let outVal = outputs[ortOutputName] else {
        return nil
      }

      let rawOut = try outVal.tensorData() as Data
      let floatCount = rawOut.count / MemoryLayout<Float>.size
      guard floatCount >= 7 else {
        return nil
      }

      var logits = [Double](repeating: 0.0, count: 7)
      rawOut.withUnsafeBytes { buf in
        let floats = buf.bindMemory(to: Float.self)
        for i in 0..<7 {
          logits[i] = Double(floats[i])
        }
      }

      // Softmax over 7 AffectNet classes:
      // 0: Anger, 1: Disgust, 2: Fear, 3: Happiness, 4: Neutral, 5: Sadness, 6: Surprise
      let maxLogit = logits.max() ?? 0.0
      let exps = logits.map { exp($0 - maxLogit) }
      let sumExps = max(1e-6, exps.reduce(0.0, +))
      let probs = exps.map { $0 / sumExps }

      let anger = probs[0]
      let disgust = probs[1]
      let fear = probs[2]
      let happiness = probs[3]
      let neutral = probs[4]
      let sadness = probs[5]
      let surprise = probs[6]

      // Exact scoring & selfie calibration from webapp/detector_service.py
      let disgustWeight = anger >= 0.14 ? 0.65 : 0.20
      let angryScore = anger + disgust * disgustWeight
      let sadScore = sadness + fear * 0.65
      let happyScore = happiness
      let surpriseScore = surprise
      let neutralScore = neutral

      let total = max(1e-6, angryScore + sadScore + happyScore + surpriseScore + neutralScore)
      let emoScores: [String: Double] = [
        "happy": happyScore / total,
        "surprise": surpriseScore / total,
        "neutral": neutralScore / total,
        "sad": sadScore / total,
        "angry": angryScore / total
      ]

      var bestEmotion = "neutral"
      var bestProb = 0.0
      for (k, v) in emoScores where v > bestProb {
        bestEmotion = k
        bestProb = v
      }

      if bestEmotion == "neutral" {
        let expressive: [(String, Double)] = [
          ("angry", emoScores["angry"] ?? 0),
          ("sad", emoScores["sad"] ?? 0),
          ("happy", emoScores["happy"] ?? 0),
          ("surprise", emoScores["surprise"] ?? 0)
        ]
        if let top = expressive.max(by: { $0.1 < $1.1 }),
           top.1 >= 0.30 && top.1 >= (emoScores["neutral"] ?? 0) * 0.68 {
          bestEmotion = top.0
          bestProb = min(0.96, top.1 / max(1e-6, top.1 + (emoScores["neutral"] ?? 0) * 0.45))
        }
      }

      return (bestEmotion, bestProb)
    } catch {
      return nil
    }
  }

  private static func makeNormalizedCHWData(cgImage: CGImage, width: Int, height: Int) -> NSMutableData? {
    let bytesPerPixel = 4
    let bytesPerRow = bytesPerPixel * width
    var rawBytes = [UInt8](repeating: 0, count: width * height * bytesPerPixel)

    let colorSpace = CGColorSpaceCreateDeviceRGB()
    guard let context = CGContext(
      data: &rawBytes,
      width: width,
      height: height,
      bitsPerComponent: 8,
      bytesPerRow: bytesPerRow,
      space: colorSpace,
      bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue
    ) else {
      return nil
    }

    context.interpolationQuality = .medium
    context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

    let planeSize = width * height
    var floats = [Float](repeating: 0.0, count: 3 * planeSize)
    let mean: [Float] = [0.485, 0.456, 0.406]
    let std: [Float] = [0.229, 0.224, 0.225]

    for y in 0..<height {
      for x in 0..<width {
        let pixelIdx = (y * width + x) * bytesPerPixel
        let outIdx = y * width + x
        floats[outIdx] = (Float(rawBytes[pixelIdx]) / 255.0 - mean[0]) / std[0]
        floats[planeSize + outIdx] = (Float(rawBytes[pixelIdx + 1]) / 255.0 - mean[1]) / std[1]
        floats[2 * planeSize + outIdx] = (Float(rawBytes[pixelIdx + 2]) / 255.0 - mean[2]) / std[2]
      }
    }

    return NSMutableData(bytes: &floats, length: floats.count * MemoryLayout<Float>.size)
  }
  #endif

  // MARK: - Orientation Helper

  private static func normalizeOrientation(_ image: UIImage) -> UIImage? {
    if image.imageOrientation == .up {
      return image
    }
    let format = UIGraphicsImageRendererFormat()
    format.scale = 1.0
    let renderer = UIGraphicsImageRenderer(size: image.size, format: format)
    return renderer.image { _ in
      image.draw(in: CGRect(origin: .zero, size: image.size))
    }
  }
}

public final class MoodSyncGlassView: ExpoView {
  private let visualEffectView = UIVisualEffectView(effect: nil)
  private let rimLayer = CAGradientLayer()
  private let rimMask = CAShapeLayer()

  private var glassStyle: String = "regular"
  private var isDarkMode: Bool = true
  private var isInteractiveGlass: Bool = true
  private var glassTintColor: UIColor?
  private var isCapsule: Bool = true
  private var fixedCornerRadius: CGFloat = 24
  private var showShadow: Bool = true

  private var didSetupHierarchy: Bool = false
  private var needsEffectRefresh: Bool = true
  private var lastAppliedBoundsSize: CGSize = .zero

  public override func didMoveToSuperview() {
    super.didMoveToSuperview()
    setupIfNeeded()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()
    setupIfNeeded()
    if window != nil {
      needsEffectRefresh = true
      applyGlassEffect()
      setNeedsLayout()
    }
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    setupIfNeeded()
    visualEffectView.frame = bounds

    if bounds.width > 0 && bounds.height > 0 {
      let radius = isCapsule ? min(bounds.width, bounds.height) * 0.5 : fixedCornerRadius

      CATransaction.begin()
      CATransaction.setDisableActions(true)

      layer.shadowPath = showShadow
        ? UIBezierPath(roundedRect: bounds, cornerRadius: radius).cgPath
        : nil
      layer.shadowOpacity = showShadow ? (isDarkMode ? 0.46 : 0.14) : 0.0

      rimLayer.frame = visualEffectView.bounds
      let rimRect = visualEffectView.bounds.insetBy(dx: 0.5, dy: 0.5)
      let rimRadius = max(0, radius - 0.5)
      rimMask.path = UIBezierPath(roundedRect: rimRect, cornerRadius: rimRadius).cgPath

      CATransaction.commit()

      if #unavailable(iOS 26.0) {
        visualEffectView.layer.cornerRadius = radius
      }

      if needsEffectRefresh || lastAppliedBoundsSize == .zero {
        lastAppliedBoundsSize = bounds.size
        needsEffectRefresh = false
        applyGlassEffect()
      }
    }
  }

  private func setupIfNeeded() {
    guard !didSetupHierarchy else { return }
    didSetupHierarchy = true

    backgroundColor = .clear
    isOpaque = false
    isUserInteractionEnabled = false
    clipsToBounds = false

    layer.shadowColor = UIColor.black.cgColor
    layer.shadowOffset = CGSize(width: 0, height: 10)
    layer.shadowRadius = 20
    layer.shadowOpacity = 0.0

    visualEffectView.isUserInteractionEnabled = false
    addSubview(visualEffectView)

    rimLayer.startPoint = CGPoint(x: 0.15, y: 0.0)
    rimLayer.endPoint = CGPoint(x: 0.85, y: 1.0)
    rimMask.fillColor = nil
    rimMask.strokeColor = UIColor.white.cgColor
    rimMask.lineWidth = 1.0
    rimLayer.mask = rimMask
    visualEffectView.contentView.layer.addSublayer(rimLayer)
  }

  func setGlassStyle(_ style: String) {
    guard glassStyle != style else { return }
    glassStyle = style
    needsEffectRefresh = true
    applyGlassEffect()
    setNeedsLayout()
  }

  func setIsDark(_ isDark: Bool) {
    guard isDarkMode != isDark else { return }
    isDarkMode = isDark
    needsEffectRefresh = true
    applyGlassEffect()
    setNeedsLayout()
  }

  func setInteractive(_ interactive: Bool) {
    guard isInteractiveGlass != interactive else { return }
    isInteractiveGlass = interactive
    needsEffectRefresh = true
    applyGlassEffect()
    setNeedsLayout()
  }

  func setGlassTintColor(_ color: UIColor?) {
    guard glassTintColor != color else { return }
    glassTintColor = color
    needsEffectRefresh = true
    applyGlassEffect()
    setNeedsLayout()
  }

  func setCapsule(_ capsule: Bool) {
    guard isCapsule != capsule else { return }
    isCapsule = capsule
    needsEffectRefresh = true
    applyGlassEffect()
    setNeedsLayout()
  }

  func setCornerRadius(_ radius: CGFloat) {
    guard fixedCornerRadius != radius else { return }
    fixedCornerRadius = radius
    needsEffectRefresh = true
    applyGlassEffect()
    setNeedsLayout()
  }

  func setShowShadow(_ show: Bool) {
    guard showShadow != show else { return }
    showShadow = show
    applyGlassEffect()
    setNeedsLayout()
  }

  private func applyGlassEffect() {
    setupIfNeeded()
    let interfaceStyle: UIUserInterfaceStyle = isDarkMode ? .dark : .light
    overrideUserInterfaceStyle = interfaceStyle
    visualEffectView.overrideUserInterfaceStyle = interfaceStyle

    if #available(iOS 26.0, *) {
      let effect = UIGlassEffect(style: glassStyle == "clear" ? .clear : .regular)
      effect.isInteractive = isInteractiveGlass
      effect.tintColor = glassTintColor
      visualEffectView.effect = effect
      visualEffectView.clipsToBounds = false
      visualEffectView.cornerConfiguration = isCapsule
        ? .capsule()
        : .uniformCorners(radius: .fixed(Double(fixedCornerRadius)))
    } else {
      let blurStyle: UIBlurEffect.Style = isDarkMode
        ? .systemChromeMaterialDark
        : .systemChromeMaterialLight
      visualEffectView.effect = UIBlurEffect(style: blurStyle)
      visualEffectView.clipsToBounds = true
      visualEffectView.layer.cornerCurve = .continuous
      visualEffectView.layer.cornerRadius = isCapsule
        ? min(bounds.width, bounds.height) * 0.5
        : fixedCornerRadius
    }

    rimLayer.colors = isDarkMode
      ? [
          UIColor(white: 1.0, alpha: 0.28).cgColor,
          UIColor(white: 1.0, alpha: 0.05).cgColor,
          UIColor(white: 1.0, alpha: 0.16).cgColor
        ]
      : [
          UIColor(white: 1.0, alpha: 0.90).cgColor,
          UIColor(white: 1.0, alpha: 0.28).cgColor,
          UIColor(white: 1.0, alpha: 0.56).cgColor
        ]

    if bounds.width > 0 && bounds.height > 0 {
      layer.shadowOpacity = showShadow ? (isDarkMode ? 0.46 : 0.14) : 0.0
    } else {
      layer.shadowOpacity = 0.0
    }
  }
}

private final class MoodSyncDisplayLinkProxy: NSObject {
  weak var target: MoodSyncLiquidTabBarView?

  init(_ target: MoodSyncLiquidTabBarView) {
    self.target = target
  }

  @objc func step(_ link: CADisplayLink) {
    target?.tickPhysics(link)
  }
}

private struct NativeTabItemModel: Equatable {
  let key: String
  let label: String
  let sfSymbol: String
  let activeSfSymbol: String
  let showBadgeDot: Bool
}

private final class NativeTabSlotView: UIView {
  let iconView = UIImageView()
  let titleLabel = UILabel()
  let badgeDot = UIView()

  override init(frame: CGRect) {
    super.init(frame: frame)
    isUserInteractionEnabled = false

    iconView.contentMode = .scaleAspectFit
    iconView.isUserInteractionEnabled = false
    addSubview(iconView)

    titleLabel.font = UIFont.systemFont(ofSize: 10.2, weight: .semibold)
    titleLabel.textAlignment = .center
    titleLabel.lineBreakMode = .byTruncatingTail
    titleLabel.isUserInteractionEnabled = false
    addSubview(titleLabel)

    badgeDot.layer.cornerRadius = 3.5
    badgeDot.isHidden = true
    badgeDot.isUserInteractionEnabled = false
    addSubview(badgeDot)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    let w = bounds.width
    let h = bounds.height
    let iconSize: CGFloat = 20.5
    let totalContentH: CGFloat = 20.5 + 2.5 + 12.5
    let topY = (h - totalContentH) * 0.5
    iconView.frame = CGRect(x: (w - iconSize) * 0.5, y: topY, width: iconSize, height: iconSize)
    titleLabel.frame = CGRect(x: 2, y: topY + iconSize + 2.5, width: max(0, w - 4), height: 13.5)
    badgeDot.frame = CGRect(x: iconView.frame.maxX - 3, y: iconView.frame.minY - 1, width: 6.5, height: 6.5)
  }
}

public final class MoodSyncLiquidTabBarView: ExpoView {
  let onSelectTab = EventDispatcher()

  private let barHeight: CGFloat = 60
  private let pillInset: CGFloat = 4.0
  private let restHeight: CGFloat = 49
  private let holdHeight: CGFloat = 66
  private let barHorizontalMargin: CGFloat = 24
  private let barMaxWidth: CGFloat = 366

  private var tabItems: [NativeTabItemModel] = []
  private var activeTabKey: String = ""
  private var isDarkMode: Bool = true
  private var accentColor: UIColor = UIColor(red: 1.0, green: 0.384, blue: 0.259, alpha: 1.0)

  private let barContainer = UIView()
  private let barGlassView = UIVisualEffectView(effect: nil)
  private let bubbleGlassView = UIVisualEffectView(effect: nil)
  private let bubbleRimLayer = CAGradientLayer()
  private let bubbleRimMask = CAShapeLayer()

  private let unselectedRow = UIView()
  private let selectedRow = UIView()
  private var unselectedSlots: [NativeTabSlotView] = []
  private var selectedSlots: [NativeTabSlotView] = []

  private let outsideMaskLayer = CAShapeLayer()
  private let insideMaskLayer = CAShapeLayer()

  // Physics state
  private var hasInitializedGeometry = false
  private var currentCenterX: CGFloat = 0
  private var velX: CGFloat = 0
  private var currentW: CGFloat = 80
  private var velW: CGFloat = 0
  private var currentH: CGFloat = 55
  private var velH: CGFloat = 0
  private var currentLP: CGFloat = 0
  private var velLP: CGFloat = 0
  private var barShiftX: CGFloat = 0
  private var velBarX: CGFloat = 0

  private var isTouching = false
  private var hasDragged = false
  private var touchStartX: CGFloat = 0
  private var tapIdx: Int = 0
  private var fingerCenterX: CGFloat = 0
  private var restTargetIdx: Int = 0
  private var lastCrossedIdx: Int = 0
  private var leapUntil: CFTimeInterval = 0
  private var lastFrameTime: CFTimeInterval = 0
  private var bubbleIsActiveGlass: Bool?
  private var lastBuiltDarkMode: Bool?

  private var displayLink: CADisplayLink?
  private var displayLinkProxy: MoodSyncDisplayLinkProxy?
  private let impactGen = UIImpactFeedbackGenerator(style: .light)
  private let selectGen = UISelectionFeedbackGenerator()

  private var didSetupHierarchy = false

  deinit {
    stopDisplayLink()
  }

  public override func willMove(toWindow newWindow: UIWindow?) {
    super.willMove(toWindow: newWindow)
    if newWindow == nil {
      stopDisplayLink()
    }
  }

  public override func didMoveToSuperview() {
    super.didMoveToSuperview()
    setupIfNeeded()
  }

  public override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
    let interactiveArea = barContainer.frame.insetBy(dx: -8, dy: -10)
    guard interactiveArea.contains(point) else {
      return nil
    }
    return self
  }

  private func setupIfNeeded() {
    guard !didSetupHierarchy else { return }
    didSetupHierarchy = true

    backgroundColor = .clear
    isOpaque = false
    clipsToBounds = false
    isMultipleTouchEnabled = false

    barContainer.backgroundColor = .clear
    barContainer.clipsToBounds = false
    barContainer.isUserInteractionEnabled = false
    addSubview(barContainer)

    barGlassView.isUserInteractionEnabled = false
    barGlassView.layer.zPosition = 1
    barContainer.addSubview(barGlassView)

    unselectedRow.backgroundColor = .clear
    unselectedRow.isUserInteractionEnabled = false
    unselectedRow.layer.zPosition = 10
    outsideMaskLayer.fillRule = .evenOdd
    outsideMaskLayer.fillColor = UIColor.black.cgColor
    unselectedRow.layer.mask = outsideMaskLayer
    barContainer.addSubview(unselectedRow)

    selectedRow.backgroundColor = .clear
    selectedRow.isUserInteractionEnabled = false
    selectedRow.layer.zPosition = 11
    insideMaskLayer.fillColor = UIColor.black.cgColor
    selectedRow.layer.mask = insideMaskLayer
    barContainer.addSubview(selectedRow)

    bubbleGlassView.isUserInteractionEnabled = false
    bubbleGlassView.layer.zPosition = 5
    bubbleGlassView.layer.shadowColor = UIColor.black.cgColor
    bubbleGlassView.layer.shadowOffset = CGSize(width: 0, height: 8)
    bubbleGlassView.layer.shadowRadius = 16
    bubbleGlassView.layer.shadowOpacity = 0.0

    bubbleRimLayer.colors = [
      UIColor(red: 0.45, green: 0.86, blue: 1.0, alpha: 0.85).cgColor,
      UIColor(white: 1.0, alpha: 0.14).cgColor,
      UIColor(red: 1.0, green: 0.50, blue: 0.35, alpha: 0.72).cgColor
    ]
    bubbleRimLayer.startPoint = CGPoint(x: 0.08, y: 0.0)
    bubbleRimLayer.endPoint = CGPoint(x: 0.92, y: 1.0)
    bubbleRimLayer.opacity = 0.0

    bubbleRimMask.fillColor = nil
    bubbleRimMask.strokeColor = UIColor.white.cgColor
    bubbleRimMask.lineWidth = 1.4
    bubbleRimLayer.mask = bubbleRimMask
    bubbleGlassView.contentView.layer.addSublayer(bubbleRimLayer)

    barContainer.addSubview(bubbleGlassView)

    applyAppearance()
  }

  private var slotWidth: CGFloat {
    let count = CGFloat(max(1, tabItems.count))
    return max(0, (barContainer.bounds.width - pillInset * 2) / count)
  }

  private var restBubbleWidth: CGFloat {
    return max(36.0, slotWidth - 6.0)
  }

  private func barBaseOriginXAndWidth() -> (CGFloat, CGFloat) {
    let availW = max(0, bounds.width - barHorizontalMargin * 2)
    let barW = min(barMaxWidth, availW)
    let baseBarX = (bounds.width - barW) * 0.5
    return (baseBarX, barW)
  }

  private func centerX(for idx: Int) -> CGFloat {
    let sw = slotWidth
    return pillInset + (CGFloat(idx) + 0.5) * sw
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    setupIfNeeded()

    let (barX, barW) = barBaseOriginXAndWidth()
    let barY = (bounds.height - barHeight) * 0.5

    barContainer.frame = CGRect(x: barX + barShiftX, y: barY, width: barW, height: barHeight)
    if barW > 0 {
      barContainer.layer.shadowPath = UIBezierPath(
        roundedRect: barContainer.bounds,
        cornerRadius: barHeight * 0.5
      ).cgPath
    }
    barGlassView.frame = barContainer.bounds
    unselectedRow.frame = barContainer.bounds
    selectedRow.frame = barContainer.bounds

    let sw = slotWidth
    for i in 0..<tabItems.count {
      let slotFrame = CGRect(x: pillInset + CGFloat(i) * sw, y: 0, width: sw, height: barHeight)
      if i < unselectedSlots.count {
        unselectedSlots[i].frame = slotFrame
      }
      if i < selectedSlots.count {
        selectedSlots[i].frame = slotFrame
      }
    }

    if #unavailable(iOS 26.0) {
      barGlassView.layer.cornerRadius = barHeight * 0.5
    }

    if !hasInitializedGeometry && sw > 0 && !tabItems.isEmpty {
      hasInitializedGeometry = true
      let idx = resolvedActiveIndex()
      restTargetIdx = idx
      lastCrossedIdx = idx
      currentCenterX = centerX(for: idx)
      currentW = restBubbleWidth
      currentH = restHeight
      currentLP = 0
      fingerCenterX = currentCenterX
      applyFrameGeometry()
    } else if sw > 0 && !tabItems.isEmpty {
      if !isTouching && displayLink == nil {
        currentCenterX = centerX(for: restTargetIdx)
        currentW = restBubbleWidth
        currentH = restHeight
      }
      applyFrameGeometry()
    }
  }

  func setTabs(_ rawTabs: [[String: Any]]) {
    setupIfNeeded()
    let parsed: [NativeTabItemModel] = rawTabs.compactMap { dict in
      guard let key = dict["key"] as? String,
            let label = dict["label"] as? String else {
        return nil
      }
      let sfSymbol = (dict["sfSymbol"] as? String) ?? "circle"
      let activeSfSymbol = (dict["activeSfSymbol"] as? String) ?? sfSymbol
      let showBadgeDot = (dict["showBadgeDot"] as? Bool) ?? false
      return NativeTabItemModel(
        key: key,
        label: label,
        sfSymbol: sfSymbol,
        activeSfSymbol: activeSfSymbol,
        showBadgeDot: showBadgeDot
      )
    }

    guard parsed != tabItems else { return }
    tabItems = parsed
    rebuildSlotViews()

    let idx = resolvedActiveIndex()
    restTargetIdx = idx
    lastCrossedIdx = idx
    if slotWidth > 0 {
      currentCenterX = centerX(for: idx)
      currentW = restBubbleWidth
      currentH = restHeight
    }
    setNeedsLayout()
  }

  func setActiveTab(_ key: String) {
    setupIfNeeded()
    guard activeTabKey != key else { return }
    activeTabKey = key

    let newIdx = resolvedActiveIndex()
    if !isTouching && restTargetIdx != newIdx {
      restTargetIdx = newIdx
      lastCrossedIdx = newIdx
      if hasInitializedGeometry {
        leapUntil = CACurrentMediaTime() + 0.28
        velW += 110
        velH += 130
        ensureDisplayLink()
      }
    }
  }

  func setIsDark(_ isDark: Bool) {
    setupIfNeeded()
    guard isDarkMode != isDark || lastBuiltDarkMode == nil else { return }
    isDarkMode = isDark
    applyAppearance()
  }

  func setAccentColor(_ color: UIColor) {
    setupIfNeeded()
    guard accentColor != color else { return }
    accentColor = color
    updateSlotColors()
  }

  private func resolvedActiveIndex() -> Int {
    guard !tabItems.isEmpty else { return 0 }
    if let idx = tabItems.firstIndex(where: { $0.key == activeTabKey }) {
      return idx
    }
    return 0
  }

  private func rebuildSlotViews() {
    unselectedSlots.forEach { $0.removeFromSuperview() }
    selectedSlots.forEach { $0.removeFromSuperview() }
    unselectedSlots.removeAll()
    selectedSlots.removeAll()

    let symbolCfg = UIImage.SymbolConfiguration(pointSize: 17.5, weight: .semibold)

    for item in tabItems {
      let uSlot = NativeTabSlotView()
      uSlot.iconView.image = UIImage(systemName: item.sfSymbol, withConfiguration: symbolCfg)?.withRenderingMode(.alwaysTemplate)
      uSlot.titleLabel.text = item.label
      uSlot.badgeDot.isHidden = !item.showBadgeDot
      unselectedRow.addSubview(uSlot)
      unselectedSlots.append(uSlot)

      let sSlot = NativeTabSlotView()
      sSlot.iconView.image = UIImage(systemName: item.activeSfSymbol, withConfiguration: symbolCfg)?.withRenderingMode(.alwaysTemplate)
      sSlot.titleLabel.text = item.label
      sSlot.titleLabel.font = UIFont.systemFont(ofSize: 10.2, weight: .bold)
      sSlot.badgeDot.isHidden = !item.showBadgeDot
      selectedRow.addSubview(sSlot)
      selectedSlots.append(sSlot)
    }

    updateSlotColors()
  }

  private func updateSlotColors() {
    let unselectedIconColor = isDarkMode
      ? UIColor(white: 1.0, alpha: 0.92)
      : UIColor(red: 24.0 / 255.0, green: 29.0 / 255.0, blue: 37.0 / 255.0, alpha: 0.88)
    let unselectedTextColor = isDarkMode
      ? UIColor(white: 1.0, alpha: 0.82)
      : UIColor(red: 24.0 / 255.0, green: 29.0 / 255.0, blue: 37.0 / 255.0, alpha: 0.72)

    for slot in unselectedSlots {
      slot.iconView.tintColor = unselectedIconColor
      slot.titleLabel.textColor = unselectedTextColor
      slot.badgeDot.backgroundColor = accentColor
    }

    for slot in selectedSlots {
      slot.iconView.tintColor = accentColor
      slot.titleLabel.textColor = accentColor
      slot.badgeDot.backgroundColor = accentColor
    }
  }

  private func applyAppearance() {
    let style: UIUserInterfaceStyle = isDarkMode ? .dark : .light
    overrideUserInterfaceStyle = style
    barGlassView.overrideUserInterfaceStyle = style
    bubbleGlassView.overrideUserInterfaceStyle = style

    if lastBuiltDarkMode != isDarkMode {
      lastBuiltDarkMode = isDarkMode
      if #available(iOS 26.0, *) {
        let barEffect = UIGlassEffect(style: .regular)
        barEffect.isInteractive = true
        barGlassView.effect = barEffect
        barGlassView.clipsToBounds = false
        barGlassView.cornerConfiguration = .capsule()
      } else {
        barGlassView.effect = UIBlurEffect(
          style: isDarkMode ? .systemChromeMaterialDark : .systemChromeMaterialLight
        )
        barGlassView.clipsToBounds = true
        barGlassView.layer.cornerCurve = .continuous
        barGlassView.layer.cornerRadius = barHeight * 0.5
      }
      updateBubbleEffect(active: bubbleIsActiveGlass ?? false, force: true)
    }

    barContainer.layer.shadowColor = UIColor.black.cgColor
    barContainer.layer.shadowOffset = CGSize(width: 0, height: 10)
    barContainer.layer.shadowRadius = 22
    barContainer.layer.shadowOpacity = isDarkMode ? 0.50 : 0.14

    updateSlotColors()
  }

  private func updateBubbleEffect(active: Bool, force: Bool = false) {
    if !force && bubbleIsActiveGlass == active {
      return
    }
    bubbleIsActiveGlass = active
    bubbleGlassView.layer.zPosition = active ? 20 : 5

    if #available(iOS 26.0, *) {
      let effect = UIGlassEffect(style: .clear)
      effect.isInteractive = true
      effect.tintColor = active
        ? nil
        : (isDarkMode
          ? UIColor.white.withAlphaComponent(0.14)
          : UIColor.black.withAlphaComponent(0.08))
      bubbleGlassView.effect = effect
      bubbleGlassView.clipsToBounds = false
      bubbleGlassView.cornerConfiguration = .capsule()
    } else {
      bubbleGlassView.effect = UIBlurEffect(
        style: isDarkMode ? .systemUltraThinMaterialDark : .systemUltraThinMaterialLight
      )
      bubbleGlassView.backgroundColor = active
        ? UIColor.white.withAlphaComponent(isDarkMode ? 0.10 : 0.35)
        : UIColor.white.withAlphaComponent(isDarkMode ? 0.14 : 0.45)
      bubbleGlassView.clipsToBounds = true
      bubbleGlassView.layer.cornerCurve = .continuous
      bubbleGlassView.layer.cornerRadius = currentH * 0.5
    }
  }

  // MARK: - Touch Handling (Tap + Drag)

  private func barLocalX(from touch: UITouch) -> CGFloat {
    let (baseBarX, _) = barBaseOriginXAndWidth()
    return touch.location(in: self).x - baseBarX
  }

  public override func touchesBegan(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard let touch = touches.first, !tabItems.isEmpty, slotWidth > 0 else { return }
    let localX = barLocalX(from: touch)
    let sw = slotWidth
    let count = tabItems.count

    let idx = max(0, min(count - 1, Int(floor((localX - pillInset) / sw))))
    touchStartX = localX
    tapIdx = idx
    hasDragged = false
    isTouching = true
    leapUntil = 0
    fingerCenterX = localX

    // Jelly pop impulse
    velW += 170
    velH += 210

    impactGen.prepare()
    impactGen.impactOccurred(intensity: 0.65)
    selectGen.prepare()

    ensureDisplayLink()
  }

  public override func touchesMoved(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard isTouching, let touch = touches.first else { return }
    let localX = barLocalX(from: touch)
    if abs(localX - touchStartX) > 8.0 {
      hasDragged = true
    }
    fingerCenterX = localX
    ensureDisplayLink()
  }

  public override func touchesEnded(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard isTouching else { return }
    isTouching = false
    guard !tabItems.isEmpty, slotWidth > 0 else { return }

    let sw = slotWidth
    let count = tabItems.count
    let firstX = centerX(for: 0)
    let lastX = centerX(for: count - 1)

    let finalIdx: Int
    if !hasDragged {
      // Crisp single tap directly selects tapped tab
      finalIdx = tapIdx
      leapUntil = CACurrentMediaTime() + 0.28
      velW += 110
      velH += 140
    } else {
      let clampedFinger = clampVal(fingerCenterX, firstX, lastX)
      let blendedX = currentCenterX * 0.5 + clampedFinger * 0.5
      finalIdx = max(0, min(count - 1, Int(round((blendedX - firstX) / sw))))
      velW += 80
      velH -= 95
    }

    restTargetIdx = finalIdx
    lastCrossedIdx = finalIdx
    let targetKey = tabItems[finalIdx].key
    if activeTabKey != targetKey {
      activeTabKey = targetKey
    }
    onSelectTab(["key": targetKey])
    ensureDisplayLink()
  }

  public override func touchesCancelled(_ touches: Set<UITouch>, with event: UIEvent?) {
    guard isTouching else { return }
    isTouching = false
    restTargetIdx = resolvedActiveIndex()
    ensureDisplayLink()
  }

  // MARK: - 120Hz CADisplayLink Physics Engine

  private func ensureDisplayLink() {
    guard displayLink == nil else { return }
    lastFrameTime = 0
    let proxy = MoodSyncDisplayLinkProxy(self)
    displayLinkProxy = proxy
    let link = CADisplayLink(target: proxy, selector: #selector(MoodSyncDisplayLinkProxy.step(_:)))
    link.preferredFrameRateRange = CAFrameRateRange(minimum: 60, maximum: 120, preferred: 120)
    link.add(to: .main, forMode: .common)
    displayLink = link
  }

  private func stopDisplayLink() {
    displayLink?.invalidate()
    displayLink = nil
    displayLinkProxy = nil
  }

  private func clampVal(_ v: CGFloat, _ lo: CGFloat, _ hi: CGFloat) -> CGFloat {
    return max(lo, min(hi, v))
  }

  private func stepSpring(
    _ val: CGFloat,
    _ vel: CGFloat,
    _ target: CGFloat,
    _ stiffness: CGFloat,
    _ damping: CGFloat,
    _ dt: CGFloat
  ) -> (CGFloat, CGFloat) {
    let acc = stiffness * (target - val) - damping * vel
    let nextVel = vel + acc * dt
    let nextVal = val + nextVel * dt
    return (nextVal, nextVel)
  }

  fileprivate func tickPhysics(_ link: CADisplayLink) {
    let sw = slotWidth
    let count = tabItems.count
    guard sw > 0, count > 0 else {
      stopDisplayLink()
      return
    }

    let now = CACurrentMediaTime()
    let dt: CGFloat = lastFrameTime > 0 ? clampVal(CGFloat(now - lastFrameTime), 0.004, 0.032) : 0.0083
    lastFrameTime = now

    let firstX = centerX(for: 0)
    let lastX = centerX(for: count - 1)

    // Rubber-banded finger position
    var clampedFingerX = fingerCenterX
    if fingerCenterX < firstX {
      clampedFingerX = firstX + (fingerCenterX - firstX) * 0.22
    } else if fingerCenterX > lastX {
      clampedFingerX = lastX + (fingerCenterX - lastX) * 0.22
    }

    var effectiveTargetX = centerX(for: restTargetIdx)
    if isTouching {
      if count > 1 {
        let clampedInSpan = clampVal(clampedFingerX, firstX, lastX)
        let u = (clampedInSpan - firstX) / sw
        let delta = u - round(u)
        // Very gentle detent (0.06) so dragging glides smoothly instead of snapping early
        let detentPull = 0.06 * sw * sin(2.0 * .pi * delta)
        effectiveTargetX = clampedFingerX - detentPull
      } else {
        effectiveTargetX = clampedFingerX
      }
    }

    // Well-damped springs: silky drag tracking & zero wide overshoot on far tab taps
    let posStiffness: CGFloat = isTouching ? 115 : 260
    let posDamping: CGFloat = isTouching ? 18.5 : 26.5
    (currentCenterX, velX) = stepSpring(currentCenterX, velX, effectiveTargetX, posStiffness, posDamping, dt)

    if !isTouching {
      currentCenterX = clampVal(currentCenterX, firstX - 4.0, lastX + 4.0)
    }

    let tension: CGFloat = isTouching ? (clampedFingerX - currentCenterX) : 0
    let speed = abs(velX)
    let isLeaping = !isTouching && now < leapUntil
    let restW = restBubbleWidth

    var targetLP: CGFloat = 0
    var targetW: CGFloat = restW
    var targetH: CGFloat = restHeight
    var targetBarShiftX: CGFloat = 0

    if isTouching {
      let holdW = restW + 12.0
      let holdH = holdHeight
      let wobble = CGFloat(sin(now * 7.8)) * 2.4 + CGFloat(cos(now * 12.4)) * 0.6
      let stretch = clampVal(abs(tension) * 0.22 + speed * 0.013, 0, 18)
      targetLP = 1.0
      targetW = holdW + wobble + stretch
      targetH = max(50.0, holdH - wobble * 0.8 - stretch * 0.30)
      targetBarShiftX = clampVal(tension * 0.08, -5.0, 5.0)
    } else if isLeaping {
      let leapStretch = clampVal(speed * 0.010, 0, 12)
      targetLP = 0.82
      targetW = restW + 10.0 + leapStretch
      targetH = max(50.0, 56.0 - leapStretch * 0.25)
    }

    (currentW, velW) = stepSpring(currentW, velW, targetW, 290, 14.5, dt)
    (currentH, velH) = stepSpring(currentH, velH, targetH, 290, 14.5, dt)
    (currentLP, velLP) = stepSpring(currentLP, velLP, targetLP, 250, 18.0, dt)
    (barShiftX, velBarX) = stepSpring(barShiftX, velBarX, targetBarShiftX, 220, 16.0, dt)

    if isTouching {
      let clampedPos = clampVal(currentCenterX, firstX, lastX)
      let crossed = max(0, min(count - 1, Int(round((clampedPos - firstX) / sw))))
      if crossed != lastCrossedIdx {
        lastCrossedIdx = crossed
        selectGen.selectionChanged()
        velW -= 95
        velH += 120
      }
    }

    applyFrameGeometry()

    let settled =
      !isTouching &&
      !isLeaping &&
      abs(currentCenterX - effectiveTargetX) < 0.08 &&
      abs(velX) < 0.4 &&
      abs(currentW - restW) < 0.08 &&
      abs(velW) < 0.4 &&
      abs(currentH - restHeight) < 0.08 &&
      abs(velH) < 0.4 &&
      abs(currentLP) < 0.005 &&
      abs(velLP) < 0.02 &&
      abs(barShiftX) < 0.05 &&
      abs(velBarX) < 0.3

    if settled {
      currentCenterX = effectiveTargetX
      velX = 0
      currentW = restW
      velW = 0
      currentH = restHeight
      velH = 0
      currentLP = 0
      velLP = 0
      barShiftX = 0
      velBarX = 0
      applyFrameGeometry()
      stopDisplayLink()
    }
  }

  private func applyFrameGeometry() {
    guard barContainer.bounds.width > 0 else { return }

    let clampedLP = clampVal(currentLP, 0, 1)
    let isActiveGlass = clampedLP > 0.04
    updateBubbleEffect(active: isActiveGlass)

    let (baseBarX, barW) = barBaseOriginXAndWidth()
    let barY = (bounds.height - barHeight) * 0.5
    let barCenterY = barHeight * 0.5

    let safeW = max(36.0, currentW)
    let safeH = max(36.0, currentH)
    let bubbleRect = CGRect(
      x: currentCenterX - safeW * 0.5,
      y: barCenterY - safeH * 0.5,
      width: safeW,
      height: safeH
    )
    let bubblePath = UIBezierPath(roundedRect: bubbleRect, cornerRadius: safeH * 0.5)

    CATransaction.begin()
    CATransaction.setDisableActions(true)

    barContainer.frame = CGRect(x: baseBarX + barShiftX, y: barY, width: barW, height: barHeight)

    bubbleGlassView.bounds = CGRect(x: 0, y: 0, width: safeW, height: safeH)
    bubbleGlassView.center = CGPoint(x: currentCenterX, y: barCenterY)
    bubbleGlassView.layer.shadowPath = UIBezierPath(
      roundedRect: bubbleGlassView.bounds,
      cornerRadius: safeH * 0.5
    ).cgPath
    bubbleGlassView.layer.shadowOpacity = Float(clampedLP * (isDarkMode ? 0.38 : 0.14))

    if #unavailable(iOS 26.0) {
      bubbleGlassView.layer.cornerRadius = safeH * 0.5
    }

    // Prismatic liquid glass rim highlight
    bubbleRimLayer.frame = bubbleGlassView.bounds
    let rimInsetRect = bubbleGlassView.bounds.insetBy(dx: 0.7, dy: 0.7)
    let rimPath = UIBezierPath(
      roundedRect: rimInsetRect,
      cornerRadius: max(0, rimInsetRect.height * 0.5)
    )
    bubbleRimMask.path = rimPath.cgPath
    bubbleRimLayer.opacity = Float(clampedLP * 0.68)
    let shift = clampVal(velX / 1200.0, -0.32, 0.32)
    bubbleRimLayer.startPoint = CGPoint(x: 0.08 + shift, y: 0.0)
    bubbleRimLayer.endPoint = CGPoint(x: 0.92 + shift, y: 1.0)

    // Mathematical complement masks for partial color reveal
    insideMaskLayer.path = bubblePath.cgPath

    let outerPath = UIBezierPath(rect: barContainer.bounds.insetBy(dx: -40, dy: -40))
    outerPath.append(bubblePath)
    outsideMaskLayer.path = outerPath.cgPath

    CATransaction.commit()
  }
}
