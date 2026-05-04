import Foundation
import React
import UIKit

#if canImport(RoomPlan)
import RoomPlan
import simd
#endif

@objc(RoomScannerModule)
final class RoomScannerModule: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    true
  }

  @objc
  func isSupported(
    _ resolve: RCTPromiseResolveBlock,
    rejecter reject: RCTPromiseRejectBlock
  ) {
    #if canImport(RoomPlan)
    if #available(iOS 16.0, *) {
      resolve(RoomCaptureSession.isSupported)
      return
    }
    #endif

    resolve(false)
  }

  @objc
  func scanRoom(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    #if canImport(RoomPlan)
    if #available(iOS 16.0, *) {
      guard RoomCaptureSession.isSupported else {
        reject(
          "ROOMPLAN_UNSUPPORTED",
          "RoomPlan requires a supported LiDAR device.",
          nil
        )
        return
      }

      DispatchQueue.main.async {
        guard let presenter = RCTPresentedViewController() else {
          reject(
            "NO_VIEW_CONTROLLER",
            "Room scanning needs an active iOS view controller.",
            nil
          )
          return
        }

        let scanner = RoomPlanScanViewController(resolve: resolve, reject: reject)
        let navigationController = UINavigationController(rootViewController: scanner)
        navigationController.modalPresentationStyle = .fullScreen
        presenter.present(navigationController, animated: true)
      }
      return
    }
    #endif

    reject(
      "ROOMPLAN_UNSUPPORTED",
      "RoomPlan requires iOS 16 or later on a supported LiDAR device.",
      nil
    )
  }
}

#if canImport(RoomPlan)
@available(iOS 16.0, *)
private final class RoomPlanScanViewController: UIViewController, RoomCaptureViewDelegate {
  private let resolve: RCTPromiseResolveBlock
  private let reject: RCTPromiseRejectBlock
  private let roomCaptureView = RoomCaptureView(frame: .zero)
  private var didComplete = false

  init(
    resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    self.resolve = resolve
    self.reject = reject
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()

    title = "Room Scan"
    view.backgroundColor = .black
    navigationItem.leftBarButtonItem = UIBarButtonItem(
      barButtonSystemItem: .cancel,
      target: self,
      action: #selector(cancelScan)
    )
    navigationItem.rightBarButtonItem = UIBarButtonItem(
      title: "Done",
      style: .done,
      target: self,
      action: #selector(finishScan)
    )

    roomCaptureView.delegate = self
    roomCaptureView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(roomCaptureView)

    NSLayoutConstraint.activate([
      roomCaptureView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      roomCaptureView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      roomCaptureView.topAnchor.constraint(equalTo: view.topAnchor),
      roomCaptureView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
    ])
  }

  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)

    let configuration = RoomCaptureSession.Configuration()
    roomCaptureView.captureSession.run(configuration: configuration)
  }

  override func viewWillDisappear(_ animated: Bool) {
    super.viewWillDisappear(animated)

    if !didComplete {
      roomCaptureView.captureSession.stop()
    }
  }

  @objc
  private func cancelScan() {
    didComplete = true
    roomCaptureView.captureSession.stop()
    dismiss(animated: true) {
      self.reject("SCAN_CANCELLED", "Room scan was cancelled.", nil)
    }
  }

  @objc
  private func finishScan() {
    navigationItem.rightBarButtonItem?.isEnabled = false
    roomCaptureView.captureSession.stop()
  }

  func captureView(
    shouldPresent roomDataForProcessing: CapturedRoomData,
    error: Error?
  ) -> Bool {
    if let error {
      completeWithError(error)
      return false
    }

    return true
  }

  func captureView(
    didPresent processedResult: CapturedRoom,
    error: Error?
  ) {
    if let error {
      completeWithError(error)
      return
    }

    didComplete = true
    let roomModel = makeRoomModel(from: processedResult)
    dismiss(animated: true) {
      self.resolve(roomModel)
    }
  }

  private func completeWithError(_ error: Error) {
    didComplete = true
    dismiss(animated: true) {
      self.reject(
        "ROOMPLAN_SCAN_FAILED",
        "RoomPlan could not complete the scan.",
        error
      )
    }
  }

  private func makeRoomModel(from capturedRoom: CapturedRoom) -> [String: Any] {
    var surfaces: [[String: Any]] = []
    surfaces.append(contentsOf: capturedRoom.floors.map { surfaceDictionary($0, type: "floor") })
    surfaces.append(contentsOf: capturedRoom.walls.map { surfaceDictionary($0, type: "wall") })

    if #available(iOS 17.0, *) {
      surfaces.append(contentsOf: capturedRoom.ceilings.map { surfaceDictionary($0, type: "ceiling") })
    }

    var openings: [[String: Any]] = []
    openings.append(contentsOf: capturedRoom.doors.map { openingDictionary($0, type: "door") })
    openings.append(contentsOf: capturedRoom.windows.map { openingDictionary($0, type: "window") })
    openings.append(contentsOf: capturedRoom.openings.map { openingDictionary($0, type: "opening") })

    return [
      "id": UUID().uuidString,
      "name": "iOS RoomPlan Scan",
      "createdAt": ISO8601DateFormatter().string(from: Date()),
      "scanner": "ios-roomplan",
      "units": "meters",
      "surfaces": surfaces,
      "openings": openings
    ]
  }

  private func surfaceDictionary(
    _ surface: CapturedRoom.Surface,
    type: String
  ) -> [String: Any] {
    [
      "id": surface.identifier.uuidString,
      "type": type,
      "center": vectorDictionary(surface.transform.translation),
      "size": vectorDictionary(surface.dimensions),
      "rotation": ["x": 0, "y": 0, "z": 0]
    ]
  }

  private func openingDictionary(
    _ surface: CapturedRoom.Surface,
    type: String
  ) -> [String: Any] {
    [
      "id": surface.identifier.uuidString,
      "type": type,
      "parentSurfaceId": "",
      "center": vectorDictionary(surface.transform.translation),
      "size": vectorDictionary(surface.dimensions)
    ]
  }

  private func vectorDictionary(_ vector: simd_float3) -> [String: Float] {
    ["x": vector.x, "y": vector.y, "z": vector.z]
  }
}

@available(iOS 16.0, *)
private extension simd_float4x4 {
  var translation: simd_float3 {
    simd_float3(columns.3.x, columns.3.y, columns.3.z)
  }
}
#endif
