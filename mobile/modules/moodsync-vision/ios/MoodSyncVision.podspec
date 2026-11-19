Pod::Spec.new do |s|
  s.name           = 'MoodSyncVision'
  s.version        = '2.0.0'
  s.summary        = 'On-device iOS Apple Vision & AffectNet ONNX emotion recognition module for MoodSync'
  s.description    = 'Runs real-time face detection (Apple Vision) and AffectNet EfficientNet-B2 7-Emotion deep learning classification fully on-device via ONNX Runtime.'
  s.author         = 'MoodSync'
  s.homepage       = 'https://github.com/justlacia/MoodSync-iOS-Project'
  s.platforms      = { :ios => '15.1' }
  s.source         = { :git => '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.dependency 'onnxruntime-objc'

  s.frameworks     = 'Vision', 'CoreImage', 'UIKit', 'Accelerate'
  s.source_files   = '**/*.{h,m,mm,swift,hpp,cpp}'
  s.resources      = ['Models/affectnet_b2_7.onnx']

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
