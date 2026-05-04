#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(RoomScannerModule, NSObject)

RCT_EXTERN_METHOD(isSupported:
                  (RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(scanRoom:
                  (RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

@end
