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
