// audio_engine.m — the desktop app's native Audio engine (macOS).
//
// An AVAudioEngine hosts "racks". Each rack is
//
//   [source: an Audio Unit instrument, the sample player, or an input fed from the page] → [AU effects…] → rack mixer → main mixer → output
//
// and a tap on the rack mixer keeps the last few thousand samples (mono) in a
// ring the Rust side reads for its FFT (src/audio_engine/analysis.rs).
//
// There are two engine *contexts*: the live one (the output device, or manual
// rendering in tests) and, while a take renders, an offline one in manual
// rendering mode holding copies of the racks. Rack ids beginning with
// "render:" name racks in the render context; everything else is live.
//
// Other pieces: a tap on the live main mixer into a stereo ring the Rust side
// drains into a WAV (the engine's sound in a real-time recording), and an
// input source per rack (a ring the page fills with PCM: a web sound through
// the rack's Audio Unit effects).
//
// The C functions at the bottom are the whole interface (src/audio_engine/ffi.rs).
// Every one of them catches Objective-C exceptions (AVAudioEngine throws on a
// bad connection), so nothing unwinds into Rust. Strings returned are malloc'd
// and freed with ae_free. Engine state is guarded by one recursive lock; each
// ring by its own lock (or atomics where a render block reads it).
//
// Plug-in windows (the AU's own view, else AUGenericView) are made on the main
// thread, which in the app is the Tauri/AppKit run loop.

#import <Foundation/Foundation.h>
#import <AVFAudio/AVFAudio.h>
#import <AudioToolbox/AudioToolbox.h>
#import <CoreAudio/CoreAudio.h>
#import <CoreAudioKit/CoreAudioKit.h>
#import <AudioUnit/AUCocoaUIView.h>
#import <AppKit/AppKit.h>
#import <os/lock.h>
#import <objc/runtime.h>
#import <mach/mach_time.h>
#include <stdatomic.h>
#include <stdlib.h>
#include <string.h>

#define AE_RING 16384
#define AE_VOICES 8
#define AE_MAX_SAMPLE_SECONDS 60.0
/** The main-mixer tap's ring: stereo frames (about 2.7 s at 48 kHz). */
#define AE_TAP_FRAMES 131072
#define AE_RENDER_PREFIX "render:"

static char *ae_strdup(NSString *s) {
  const char *u = s ? s.UTF8String : "";
  size_t n = strlen(u);
  char *out = malloc(n + 1);
  if (out) memcpy(out, u, n + 1);
  return out;
}

static void ae_set_err(char **err, NSString *msg) {
  if (err) *err = ae_strdup(msg ?: @"Unknown error");
}

static NSString *ae_fourcc(OSType v) {
  char c[5] = { (char)((v >> 24) & 0xff), (char)((v >> 16) & 0xff), (char)((v >> 8) & 0xff), (char)(v & 0xff), 0 };
  for (int i = 0; i < 4; i++) if (c[i] < 32 || c[i] > 126) c[i] = '?';
  return [NSString stringWithUTF8String:c];
}

static uint64_t ae_host_ns(uint64_t host) {
  static mach_timebase_info_data_t tb;
  if (!tb.denom) mach_timebase_info(&tb);
  return host * tb.numer / tb.denom;
}

// ── Sample player ────────────────────────────────────────────────────────────

@interface AEZone : NSObject
@property (nonatomic, strong) AVAudioPCMBuffer *buffer;
@property (nonatomic) int lo, hi, root;
@property (nonatomic) float gain;
@end
@implementation AEZone
@end

@interface AESampler : NSObject
@property (nonatomic, weak) AVAudioEngine *engine;
@property (nonatomic, strong) AVAudioMixerNode *mix;
@property (nonatomic, strong) NSMutableArray<AVAudioPlayerNode *> *players;
@property (nonatomic, strong) NSMutableArray<AVAudioUnitVarispeed *> *speeds;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, AEZone *> *zones;
@end
@implementation AESampler {
  @public int nextVoice;
  @public float voiceRate[AE_VOICES];
  @public float bend; // semitones
}
@end

// ── Input source: PCM the page feeds, pulled by a source node ────────────────

/**
 * A stereo ring the page fills (ae_rack_feed) and the render block drains.
 * One producer, one consumer: `written` and `read` are frame counters; the
 * render block never blocks. Underrun plays silence; overrun drops the oldest.
 */
@interface AEInput : NSObject
@property (nonatomic, strong) AVAudioSourceNode *node;
@end
@implementation AEInput {
  @public float *ring; // interleaved stereo
  @public uint32_t capacity; // frames
  @public _Atomic uint64_t written;
  @public _Atomic uint64_t read;
  @public _Atomic uint64_t underruns;
}
- (void)dealloc { free(ring); }
@end

static AEInput *ae_make_input(uint32_t capacity, AVAudioFormat *fmt) {
  AEInput *in = [AEInput new];
  in->capacity = capacity < 1024 ? 1024 : capacity;
  in->ring = calloc((size_t)in->capacity * 2, sizeof(float));
  atomic_store(&in->written, 0);
  atomic_store(&in->read, 0);
  atomic_store(&in->underruns, 0);
  __weak AEInput *weak = in;
  in.node = [[AVAudioSourceNode alloc] initWithFormat:fmt renderBlock:^OSStatus(BOOL *isSilence, const AudioTimeStamp *ts, AVAudioFrameCount frames, AudioBufferList *abl) {
    (void)ts;
    AEInput *me = weak;
    float *l = (float *)abl->mBuffers[0].mData;
    float *r = abl->mNumberBuffers > 1 ? (float *)abl->mBuffers[1].mData : NULL;
    if (!me) { memset(l, 0, frames * sizeof(float)); if (r) memset(r, 0, frames * sizeof(float)); *isSilence = YES; return noErr; }
    uint64_t rd = atomic_load(&me->read), wr = atomic_load(&me->written);
    uint64_t have = wr > rd ? wr - rd : 0;
    AVAudioFrameCount n = (AVAudioFrameCount)MIN((uint64_t)frames, have);
    for (AVAudioFrameCount i = 0; i < n; i++) {
      size_t at = (size_t)((rd + i) % me->capacity) * 2;
      l[i] = me->ring[at];
      if (r) r[i] = me->ring[at + 1];
    }
    for (AVAudioFrameCount i = n; i < frames; i++) { l[i] = 0; if (r) r[i] = 0; }
    if (n < frames && have) atomic_fetch_add(&me->underruns, 1);
    atomic_store(&me->read, rd + n);
    *isSilence = n == 0;
    return noErr;
  }];
  return in;
}

/** Push interleaved stereo frames; returns how many are queued (unplayed) after. */
static uint64_t ae_input_push(AEInput *in, const float *pcm, uint32_t frames) {
  uint64_t wr = atomic_load(&in->written), rd = atomic_load(&in->read);
  // Room: drop the oldest unplayed frames so the newest always fit (latency, not silence, is what overruns cost).
  if (frames > in->capacity) { pcm += (size_t)(frames - in->capacity) * 2; frames = in->capacity; }
  uint64_t queued = wr > rd ? wr - rd : 0;
  if (queued + frames > in->capacity) atomic_store(&in->read, wr + frames - in->capacity);
  for (uint32_t i = 0; i < frames; i++) {
    size_t at = (size_t)((wr + i) % in->capacity) * 2;
    in->ring[at] = pcm[i * 2];
    in->ring[at + 1] = pcm[i * 2 + 1];
  }
  atomic_store(&in->written, wr + frames);
  rd = atomic_load(&in->read);
  return wr + frames > rd ? wr + frames - rd : 0;
}

// ── Racks and slots ──────────────────────────────────────────────────────────

@class AEContext;

@interface AESlot : NSObject
@property (nonatomic, copy) NSString *sid;
@property (nonatomic, strong) AVAudioUnit *unit;
@property (nonatomic) BOOL bypass;
@end
@implementation AESlot
@end

@interface AERack : NSObject
@property (nonatomic, copy) NSString *rid;
@property (nonatomic, weak) AEContext *cx;
@property (nonatomic, strong) AVAudioMixerNode *out;
@property (nonatomic, strong) AVAudioUnit *instrument;
@property (nonatomic, strong) AESampler *sampler;
@property (nonatomic, strong) AEInput *input;
@property (nonatomic, strong) NSMutableArray<AESlot *> *effects;
@property (nonatomic) float volume;
@property (nonatomic) BOOL mute;
@end
@implementation AERack {
  @public float ring[AE_RING];
  @public uint64_t written;
  @public os_unfair_lock ringLock;
}
@end

/** One engine and its racks: the live one, or the offline one a take renders in. */
@interface AEContext : NSObject
@property (nonatomic, strong) AVAudioEngine *engine;
@property (nonatomic, strong) NSMutableDictionary<NSString *, AERack *> *racks;
@property (nonatomic) BOOL offline;
@property (nonatomic) double offlineRate;
@property (nonatomic) float masterVolume;
@property (nonatomic) BOOL masterMute;
@property (nonatomic, strong) id configObserver;
@end
@implementation AEContext
@end

static AEContext *gLive = nil;
static AEContext *gRender = nil;
static NSRecursiveLock *gLock = nil;
static NSMutableDictionary<NSString *, NSWindow *> *gWindows = nil; // "rack/slot" → plug-in window
static NSLock *gWinLock = nil; // gWindows only: the main thread takes it, never gLock

// The main-mixer tap (the live engine's sound, for recordings).
static BOOL gTapOn = NO;
static float *gTapRing = NULL; // interleaved stereo, AE_TAP_FRAMES frames
static uint64_t gTapWritten = 0, gTapRead = 0;
static uint64_t gTapInstallNs = 0, gTapFirstNs = 0;
static double gTapRate = 0;
static os_unfair_lock gTapLock = OS_UNFAIR_LOCK_INIT;

static void ae_init_globals(void) {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    gLock = [NSRecursiveLock new];
    gWindows = [NSMutableDictionary new];
    gWinLock = [NSLock new];
    gLive = [AEContext new];
    gLive.racks = [NSMutableDictionary new];
    gLive.offlineRate = 48000;
    gLive.masterVolume = 1;
  });
}

static void ae_apply_master(AEContext *cx) {
  if (cx.engine) cx.engine.mainMixerNode.outputVolume = cx.masterMute ? 0 : cx.masterVolume;
}

static AVAudioEngine *ae_engine(AEContext *cx) {
  if (cx.engine) return cx.engine;
  AVAudioEngine *e = [AVAudioEngine new];
  cx.engine = e;
  if (cx.offline) {
    AVAudioFormat *f = [[AVAudioFormat alloc] initStandardFormatWithSampleRate:cx.offlineRate channels:2];
    NSError *err = nil;
    [e enableManualRenderingMode:AVAudioEngineManualRenderingModeOffline format:f maximumFrameCount:4096 error:&err];
  }
  (void)e.mainMixerNode; // makes main mixer → output
  ae_apply_master(cx);
  if (!cx.offline) {
    // An output device change stops the engine: start it again.
    __weak AEContext *weak = cx;
    cx.configObserver = [[NSNotificationCenter defaultCenter] addObserverForName:AVAudioEngineConfigurationChangeNotification object:e queue:nil usingBlock:^(NSNotification *n) {
      (void)n;
      dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 100 * NSEC_PER_MSEC), dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^{
        AEContext *c = weak;
        if (!c) return;
        [gLock lock];
        @try { if (c.engine && !c.engine.isRunning) { [c.engine prepare]; [c.engine startAndReturnError:nil]; } } @catch (NSException *x) { (void)x; }
        [gLock unlock];
      });
    }];
  }
  return e;
}

static double ae_rate(AEContext *cx) {
  AVAudioEngine *e = ae_engine(cx);
  if (cx.offline) return e.manualRenderingFormat.sampleRate;
  double sr = [e.outputNode outputFormatForBus:0].sampleRate;
  return sr > 0 ? sr : 48000;
}

static AVAudioFormat *ae_format(AEContext *cx) {
  return [[AVAudioFormat alloc] initStandardFormatWithSampleRate:ae_rate(cx) channels:2];
}

static BOOL ae_start(AEContext *cx, NSString **why) {
  AVAudioEngine *e = ae_engine(cx);
  if (e.isRunning) return YES;
  NSError *err = nil;
  [e prepare];
  if (![e startAndReturnError:&err]) {
    if (why) *why = err.localizedDescription ?: @"The audio engine couldn't start";
    return NO;
  }
  return YES;
}

/** The context a rack id names ("render:…" → the render context, else live), and the id inside it. */
static AEContext *ae_context_for(const char *rid, NSString **key) {
  if (!rid) return nil;
  size_t n = strlen(AE_RENDER_PREFIX);
  if (strncmp(rid, AE_RENDER_PREFIX, n) == 0) {
    if (key) *key = [NSString stringWithUTF8String:rid + n];
    return gRender;
  }
  if (key) *key = [NSString stringWithUTF8String:rid];
  return gLive;
}

static AERack *ae_rack(const char *rid) {
  NSString *key = nil;
  AEContext *cx = ae_context_for(rid, &key);
  return cx && key ? cx.racks[key] : nil;
}

static AESlot *ae_effect_slot(AERack *r, NSString *sid, NSUInteger *index) {
  for (NSUInteger i = 0; i < r.effects.count; i++) if ([r.effects[i].sid isEqualToString:sid]) { if (index) *index = i; return r.effects[i]; }
  return nil;
}

/** The node that feeds the rack's effects (the instrument, the sample player's mixer, or the input). */
static AVAudioNode *ae_source(AERack *r) {
  if (r.instrument) return r.instrument;
  if (r.sampler) return r.sampler.mix;
  if (r.input) return r.input.node;
  return nil;
}

/** Wire source → effects → rack mixer again, after any change to the chain. */
static void ae_rewire(AERack *r) {
  AEContext *cx = r.cx;
  AVAudioEngine *e = ae_engine(cx);
  AVAudioFormat *fmt = ae_format(cx);
  AVAudioNode *src = ae_source(r);
  if (src) [e disconnectNodeOutput:src];
  for (AESlot *s in r.effects) [e disconnectNodeOutput:s.unit];
  [e disconnectNodeInput:r.out];
  if (!src) return;
  AVAudioNode *prev = src;
  for (AESlot *s in r.effects) {
    [e connect:prev to:s.unit format:fmt];
    prev = s.unit;
  }
  [e connect:prev to:r.out format:fmt];
}

static void ae_apply_volume(AERack *r) {
  r.out.outputVolume = r.mute ? 0 : r.volume;
}

static void ae_close_window(NSString *key) {
  [gWinLock lock];
  NSWindow *w = gWindows[key];
  if (w) [gWindows removeObjectForKey:key];
  [gWinLock unlock];
  if (!w) return;
  dispatch_async(dispatch_get_main_queue(), ^{ [w close]; });
}

static void ae_close_windows_of(NSString *rid) {
  [gWinLock lock];
  NSArray<NSString *> *keys = gWindows.allKeys;
  [gWinLock unlock];
  for (NSString *k in keys) if ([k hasPrefix:[rid stringByAppendingString:@"/"]]) ae_close_window(k);
}

// ── Loading plug-ins safely (docs/audio-engine.md "When a plug-in crashes") ──

/** Output samples a unit made that weren't finite (NaN or ±inf), flushed to silence. */
static _Atomic uint64_t gNanFlushes = 0;

/**
 * After a unit renders: if anything it wrote isn't a finite number, the whole
 * buffer becomes silence, so one misbehaving effect can't poison the rest of
 * the rack (a NaN in a filter's state never recovers). Real-time safe: a scan
 * and a memset, no locks, no allocation.
 */
static OSStatus ae_nan_guard(void *ref, AudioUnitRenderActionFlags *flags, const AudioTimeStamp *ts, UInt32 bus, UInt32 frames, AudioBufferList *io) {
  (void)ref; (void)ts; (void)bus; (void)frames;
  if (!flags || !(*flags & kAudioUnitRenderAction_PostRender) || !io) return noErr;
  BOOL bad = NO;
  for (UInt32 b = 0; b < io->mNumberBuffers && !bad; b++) {
    const float *p = (const float *)io->mBuffers[b].mData;
    if (!p) continue;
    UInt32 n = io->mBuffers[b].mDataByteSize / sizeof(float);
    for (UInt32 i = 0; i < n; i++) if (!isfinite(p[i])) { bad = YES; break; }
  }
  if (!bad) return noErr;
  for (UInt32 b = 0; b < io->mNumberBuffers; b++) if (io->mBuffers[b].mData) memset(io->mBuffers[b].mData, 0, io->mBuffers[b].mDataByteSize);
  atomic_fetch_add(&gNanFlushes, 1);
  return noErr;
}

uint64_t ae_nan_flushes(void) { return atomic_load(&gNanFlushes); }

/** `defaults write com.shaderstudio.app AudioUnitsInProcess -bool YES` (or PLAYFIELD_AU_IN_PROCESS=1): load every unit in-process, as before. */
static BOOL ae_prefer_in_process(void) {
  const char *env = getenv("PLAYFIELD_AU_IN_PROCESS");
  if (env && env[0] == '1') return YES;
  return [[NSUserDefaults standardUserDefaults] boolForKey:@"AudioUnitsInProcess"];
}

/** 1 when the last unit loaded ended up in the app's own process (AUv2 the system couldn't move out, or in-process by choice), 0 out of process. */
static _Atomic int gLastInProcess = -1;
int ae_last_load_in_process(void) { return atomic_load(&gLastInProcess); }

static AVAudioUnit *ae_instantiate_with(AudioComponentDescription d, AudioComponentInstantiationOptions opts, NSString **why, BOOL *timedOut) {
  __block AVAudioUnit *out = nil;
  __block NSError *err = nil;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  @try {
    [AVAudioUnit instantiateWithComponentDescription:d options:opts completionHandler:^(AVAudioUnit *u, NSError *e) {
      out = u; err = e;
      dispatch_semaphore_signal(done);
    }];
  } @catch (NSException *x) {
    if (why) *why = [NSString stringWithFormat:@"The Audio Unit threw while loading (%@)", x.reason ?: x.name];
    return nil;
  }
  if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) {
    // Given up on, not waited for: if it ever finishes, the unit is just released.
    if (timedOut) *timedOut = YES;
    if (why) *why = @"The Audio Unit took too long to load";
    return nil;
  }
  if (!out && why) *why = err.localizedDescription ?: @"The Audio Unit couldn't be loaded";
  return out;
}

/**
 * Instantiate an Audio Unit, waiting up to 10 s (a timeout is a failure, not a
 * hang). Out of process where the system can: an AUv3 always; an AUv2 on
 * macOS 11 and later through Apple's hosting service, so a crash takes down
 * that service, not the app. When an out-of-process load fails outright, it's
 * tried once in-process. Each unit's output is guarded against NaN/inf.
 */
static AVAudioUnit *ae_instantiate(OSType type, OSType sub, OSType manu, NSString **why) {
  AudioComponentDescription d = { type, sub, manu, 0, 0 };
  if (!AudioComponentFindNext(NULL, &d)) { if (why) *why = @"That Audio Unit isn't installed on this Mac"; return nil; }
  BOOL timedOut = NO;
  NSString *first = nil;
  AVAudioUnit *u = nil;
  if (!ae_prefer_in_process()) u = ae_instantiate_with(d, kAudioComponentInstantiation_LoadOutOfProcess, &first, &timedOut);
  if (!u && !timedOut) u = ae_instantiate_with(d, 0, why, &timedOut);
  else if (!u && why) *why = first;
  if (!u) return nil;
  @try {
    BOOL inProc = YES;
    if (@available(macOS 10.15, *)) inProc = u.AUAudioUnit.isLoadedInProcess;
    atomic_store(&gLastInProcess, inProc ? 1 : 0);
    if (u.audioUnit) AudioUnitAddRenderNotify(u.audioUnit, ae_nan_guard, NULL);
  } @catch (NSException *x) { (void)x; }
  return u;
}

static void ae_sampler_detach(AERack *r) {
  AESampler *s = r.sampler;
  if (!s) return;
  AVAudioEngine *e = ae_engine(r.cx);
  for (AVAudioPlayerNode *p in s.players) { [p stop]; [e detachNode:p]; }
  for (AVAudioUnitVarispeed *v in s.speeds) [e detachNode:v];
  [e detachNode:s.mix];
  r.sampler = nil;
}

static void ae_clear_source(AERack *r) {
  AVAudioEngine *e = ae_engine(r.cx);
  AVAudioNode *src = ae_source(r);
  if (src) [e disconnectNodeOutput:src];
  if (r.instrument) { [e detachNode:r.instrument]; r.instrument = nil; }
  if (r.input) { [e detachNode:r.input.node]; r.input = nil; }
  ae_sampler_detach(r);
  ae_close_window([r.rid stringByAppendingString:@"/inst"]);
}

static void ae_install_tap(AERack *r) {
  __weak AERack *weak = r;
  [r.out installTapOnBus:0 bufferSize:1024 format:nil block:^(AVAudioPCMBuffer *buf, AVAudioTime *when) {
    (void)when;
    AERack *rack = weak;
    if (!rack || !buf.floatChannelData) return;
    AVAudioFrameCount n = buf.frameLength;
    AVAudioChannelCount ch = buf.format.channelCount;
    if (!n || !ch) return;
    float *const *data = buf.floatChannelData;
    BOOL interleaved = buf.format.isInterleaved;
    os_unfair_lock_lock(&rack->ringLock);
    uint64_t w = rack->written;
    for (AVAudioFrameCount i = 0; i < n; i++) {
      float sum = 0;
      for (AVAudioChannelCount c = 0; c < ch; c++) sum += interleaved ? data[0][i * ch + c] : data[c][i];
      rack->ring[(w + i) % AE_RING] = sum / (float)ch;
    }
    rack->written = w + n;
    os_unfair_lock_unlock(&rack->ringLock);
  }];
}

/** A sound file, read and converted to the engine's format (stereo, its rate). */
static AVAudioPCMBuffer *ae_load_file(AEContext *cx, NSString *path, NSString **why) {
  NSError *err = nil;
  AVAudioFile *file = [[AVAudioFile alloc] initForReading:[NSURL fileURLWithPath:path] error:&err];
  if (!file) { if (why) *why = err.localizedDescription ?: @"Couldn't read that sound"; return nil; }
  AVAudioFormat *inFmt = file.processingFormat;
  AVAudioFramePosition len = file.length;
  AVAudioFramePosition cap = (AVAudioFramePosition)(inFmt.sampleRate * AE_MAX_SAMPLE_SECONDS);
  if (len > cap) len = cap;
  if (len <= 0) { if (why) *why = @"That sound is empty"; return nil; }
  AVAudioPCMBuffer *raw = [[AVAudioPCMBuffer alloc] initWithPCMFormat:inFmt frameCapacity:(AVAudioFrameCount)len];
  if (![file readIntoBuffer:raw frameCount:(AVAudioFrameCount)len error:&err]) { if (why) *why = err.localizedDescription ?: @"Couldn't read that sound"; return nil; }
  double sr = ae_rate(cx);
  // Rate first, keeping the channels; then to stereo by hand (mono goes to both sides).
  AVAudioPCMBuffer *rated = raw;
  if (inFmt.sampleRate != sr || inFmt.commonFormat != AVAudioPCMFormatFloat32 || inFmt.isInterleaved) {
    AVAudioFormat *mid = [[AVAudioFormat alloc] initWithCommonFormat:AVAudioPCMFormatFloat32 sampleRate:sr channels:inFmt.channelCount interleaved:NO];
    AVAudioConverter *conv = [[AVAudioConverter alloc] initFromFormat:inFmt toFormat:mid];
    if (!conv) { if (why) *why = @"That sound's format isn't supported"; return nil; }
    AVAudioFrameCount outCap = (AVAudioFrameCount)((double)raw.frameLength * sr / inFmt.sampleRate) + 4096;
    rated = [[AVAudioPCMBuffer alloc] initWithPCMFormat:mid frameCapacity:outCap];
    __block BOOL given = NO;
    NSError *cerr = nil;
    AVAudioConverterOutputStatus st = [conv convertToBuffer:rated error:&cerr withInputFromBlock:^AVAudioBuffer *(AVAudioPacketCount n, AVAudioConverterInputStatus *status) {
      (void)n;
      if (given) { *status = AVAudioConverterInputStatus_EndOfStream; return nil; }
      given = YES;
      *status = AVAudioConverterInputStatus_HaveData;
      return raw;
    }];
    if (st == AVAudioConverterOutputStatus_Error) { if (why) *why = cerr.localizedDescription ?: @"Couldn't convert that sound"; return nil; }
  }
  AVAudioPCMBuffer *out = [[AVAudioPCMBuffer alloc] initWithPCMFormat:ae_format(cx) frameCapacity:rated.frameLength];
  out.frameLength = rated.frameLength;
  AVAudioChannelCount rc = rated.format.channelCount;
  for (AVAudioChannelCount c = 0; c < 2; c++) {
    const float *srcCh = rated.floatChannelData[c < rc ? c : 0];
    memcpy(out.floatChannelData[c], srcCh, sizeof(float) * rated.frameLength);
  }
  return out;
}

static AESampler *ae_make_sampler(AEContext *cx) {
  AVAudioEngine *e = ae_engine(cx);
  AVAudioFormat *fmt = ae_format(cx);
  AESampler *s = [AESampler new];
  s.engine = e;
  s.mix = [AVAudioMixerNode new];
  s.players = [NSMutableArray new];
  s.speeds = [NSMutableArray new];
  s.zones = [NSMutableDictionary new];
  [e attachNode:s.mix];
  for (int i = 0; i < AE_VOICES; i++) {
    AVAudioPlayerNode *p = [AVAudioPlayerNode new];
    AVAudioUnitVarispeed *v = [AVAudioUnitVarispeed new];
    [e attachNode:p];
    [e attachNode:v];
    [e connect:p to:v format:fmt];
    [e connect:v to:s.mix fromBus:0 toBus:(AVAudioNodeBus)i format:fmt];
    [s.players addObject:p];
    [s.speeds addObject:v];
    s->voiceRate[i] = 1;
  }
  return s;
}

static void ae_sampler_note(AESampler *s, int note, int vel) {
  AEZone *z = nil;
  // The last-added zone covering the note wins (a drum key over a pitched range).
  for (NSNumber *k in [s.zones.allKeys sortedArrayUsingSelector:@selector(compare:)]) {
    AEZone *c = s.zones[k];
    if (note >= c.lo && note <= c.hi) z = c;
  }
  if (!z || !z.buffer) return;
  int i = s->nextVoice;
  s->nextVoice = (i + 1) % AE_VOICES;
  AVAudioPlayerNode *p = s.players[i];
  AVAudioUnitVarispeed *v = s.speeds[i];
  float rate = powf(2.0f, (float)(note - z.root) / 12.0f);
  if (rate < 0.25f) rate = 0.25f;
  if (rate > 4.0f) rate = 4.0f;
  s->voiceRate[i] = rate;
  v.rate = rate * powf(2.0f, s->bend / 12.0f);
  [p stop];
  p.volume = z.gain * ((float)vel / 127.0f);
  [p scheduleBuffer:z.buffer atTime:nil options:0 completionHandler:nil];
  if (s.engine.isRunning) [p play];
}

static void ae_sampler_midi(AESampler *s, uint8_t status, uint8_t d1, uint8_t d2) {
  uint8_t kind = status & 0xf0;
  if (kind == 0x90 && d2 > 0) ae_sampler_note(s, d1, d2);
  else if (kind == 0xb0 && (d1 == 120 || d1 == 123)) { for (AVAudioPlayerNode *p in s.players) [p stop]; }
  else if (kind == 0xe0) {
    int raw = ((int)d2 << 7 | d1) - 8192;
    s->bend = 2.0f * (float)raw / 8192.0f;
    for (int i = 0; i < AE_VOICES; i++) s.speeds[i].rate = s->voiceRate[i] * powf(2.0f, s->bend / 12.0f);
  }
}

static AVAudioUnit *ae_slot_unit(AERack *r, NSString *sid) {
  if ([sid isEqualToString:@"inst"]) return r.instrument;
  return ae_effect_slot(r, sid, NULL).unit;
}

#define AE_GUARD_BEGIN ae_init_globals(); [gLock lock]; @try {
#define AE_GUARD_END(errval) } @catch (NSException *x) { ae_set_err(err, [NSString stringWithFormat:@"%@: %@", x.name, x.reason]); [gLock unlock]; return errval; } [gLock unlock];

// ── C interface ──────────────────────────────────────────────────────────────

void ae_free(char *p) { free(p); }

/** Before anything else: the live engine renders offline (manual rendering, no device) at `rate`. For tests. */
int ae_configure_offline(double rate) {
  ae_init_globals();
  [gLock lock];
  int ok = gLive.engine == nil;
  if (ok) { gLive.offline = YES; gLive.offlineRate = rate > 0 ? rate : 48000; }
  [gLock unlock];
  return ok ? 0 : -1;
}

double ae_sample_rate(void) {
  ae_init_globals();
  [gLock lock];
  double sr = 48000;
  @try { sr = ae_rate(gLive); } @catch (NSException *x) { (void)x; }
  [gLock unlock];
  return sr;
}

/** Where a unit's bundle is (its .component, or the app its extension is in), for noticing it changed; nil when the system won't say. */
static NSString *ae_component_path(AVAudioUnitComponent *c) {
  @try {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    NSURL *u = c.componentURL;
#pragma clang diagnostic pop
    if (u.isFileURL) return u.path;
  } @catch (NSException *x) { (void)x; }
  return nil;
}

/** JSON: every installed instrument and effect Audio Unit. */
char *ae_list_units(void) {
  @autoreleasepool {
    NSMutableArray *list = [NSMutableArray new];
    @try {
      AudioComponentDescription any = { 0, 0, 0, 0, 0 };
      NSArray<AVAudioUnitComponent *> *all = [[AVAudioUnitComponentManager sharedAudioUnitComponentManager] componentsMatchingDescription:any];
      for (AVAudioUnitComponent *c in all) {
        AudioComponentDescription d = c.audioComponentDescription;
        NSString *kind = nil;
        if (d.componentType == kAudioUnitType_MusicDevice) kind = @"instrument";
        else if (d.componentType == kAudioUnitType_Effect || d.componentType == kAudioUnitType_MusicEffect) kind = @"effect";
        if (!kind) continue;
        [list addObject:@{
          @"kind": kind,
          @"type": @(d.componentType), @"subtype": @(d.componentSubType), @"manufacturer": @(d.componentManufacturer),
          @"code": [NSString stringWithFormat:@"%@/%@/%@", ae_fourcc(d.componentType), ae_fourcc(d.componentSubType), ae_fourcc(d.componentManufacturer)],
          @"name": c.name ?: @"", @"vendor": c.manufacturerName ?: @"",
          @"version": c.versionString ?: @"",
          @"v3": @((d.componentFlags & kAudioComponentFlag_IsV3AudioUnit) != 0),
          @"customView": @(c.hasCustomView),
          @"path": ae_component_path(c) ?: @"",
        }];
      }
    } @catch (NSException *x) { (void)x; }
    NSData *json = [NSJSONSerialization dataWithJSONObject:list options:0 error:nil];
    return ae_strdup(json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]");
  }
}

int ae_rack_create(const char *rid, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      NSString *key = nil;
      AEContext *cx = ae_context_for(rid, &key);
      if (!cx) { ae_set_err(err, @"No render is open"); [gLock unlock]; return -3; }
      if (!cx.racks[key]) {
        AVAudioEngine *e = ae_engine(cx);
        AERack *r = [AERack new];
        r.rid = key;
        r.cx = cx;
        r.out = [AVAudioMixerNode new];
        r.effects = [NSMutableArray new];
        r.volume = 1;
        r->ringLock = OS_UNFAIR_LOCK_INIT;
        [e attachNode:r.out];
        [e connect:r.out to:e.mainMixerNode fromBus:0 toBus:[e.mainMixerNode nextAvailableInputBus] format:ae_format(cx)];
        if (cx == gLive) ae_install_tap(r);
        cx.racks[key] = r;
      }
      NSString *why = nil;
      if (!ae_start(cx, &why)) { ae_set_err(err, why); [gLock unlock]; return -2; }
    AE_GUARD_END(-1)
    return 0;
  }
}

static void ae_rack_teardown(AERack *r) {
  AVAudioEngine *e = ae_engine(r.cx);
  ae_close_windows_of(r.rid);
  ae_clear_source(r);
  for (AESlot *s in r.effects) [e detachNode:s.unit];
  if (r.cx == gLive) [r.out removeTapOnBus:0];
  [e detachNode:r.out];
}

int ae_rack_remove(const char *rid, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      if (r) {
        ae_rack_teardown(r);
        [r.cx.racks removeObjectForKey:r.rid];
      }
    AE_GUARD_END(-1)
    return 0;
  }
}

int ae_rack_volume(const char *rid, float volume, int mute, char **err) {
  AE_GUARD_BEGIN
    AERack *r = ae_rack(rid);
    if (!r) { ae_set_err(err, @"No such rack"); [gLock unlock]; return -3; }
    r.volume = volume < 0 ? 0 : volume > 2 ? 2 : volume;
    r.mute = mute != 0;
    ae_apply_volume(r);
  AE_GUARD_END(-1)
  return 0;
}

/** The rack's instrument: an Audio Unit (type/subtype/manufacturer), or type 0 for none. */
int ae_rack_set_instrument(const char *rid, uint32_t type, uint32_t sub, uint32_t manu, char **err) {
  @autoreleasepool {
    // Loaded before taking the lock: an AUv3 may call back on another thread.
    AVAudioUnit *u = nil;
    if (type) {
      NSString *why = nil;
      u = ae_instantiate(type, sub, manu, &why);
      if (!u) { ae_set_err(err, why); return -4; }
    }
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      if (!r) { ae_set_err(err, @"No such rack"); [gLock unlock]; return -3; }
      ae_clear_source(r);
      if (u) {
        [ae_engine(r.cx) attachNode:u];
        r.instrument = u;
      }
      ae_rewire(r);
      NSString *why = nil;
      if (!ae_start(r.cx, &why)) { ae_set_err(err, why); [gLock unlock]; return -2; }
    AE_GUARD_END(-1)
    return 0;
  }
}

/** Make the rack's source the sample player (its zones empty). */
int ae_rack_set_sampler(const char *rid, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      if (!r) { ae_set_err(err, @"No such rack"); [gLock unlock]; return -3; }
      if (!r.sampler) {
        ae_clear_source(r);
        r.sampler = ae_make_sampler(r.cx);
        ae_rewire(r);
      }
      NSString *why = nil;
      if (!ae_start(r.cx, &why)) { ae_set_err(err, why); [gLock unlock]; return -2; }
    AE_GUARD_END(-1)
    return 0;
  }
}

/**
 * Make the rack's source an input the page feeds (ae_rack_feed): stereo PCM
 * at the engine's rate, `capacity` frames of buffer (the cushion against a
 * late chunk; a render gives the whole length so nothing is dropped).
 */
int ae_rack_set_input(const char *rid, uint32_t capacity, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      if (!r) { ae_set_err(err, @"No such rack"); [gLock unlock]; return -3; }
      ae_clear_source(r);
      r.input = ae_make_input(capacity, ae_format(r.cx));
      [ae_engine(r.cx) attachNode:r.input.node];
      ae_rewire(r);
      NSString *why = nil;
      if (!ae_start(r.cx, &why)) { ae_set_err(err, why); [gLock unlock]; return -2; }
    AE_GUARD_END(-1)
    return 0;
  }
}

/** Interleaved stereo frames for the rack's input. Returns the frames queued after (unplayed), or < 0. */
int64_t ae_rack_feed(const char *rid, const float *pcm, uint32_t frames, char **err) {
  ae_init_globals();
  [gLock lock];
  AERack *r = ae_rack(rid);
  AEInput *in = r.input;
  [gLock unlock];
  if (!in) { ae_set_err(err, @"That rack has no input"); return -3; }
  if (!pcm || !frames) return (int64_t)(atomic_load(&in->written) - atomic_load(&in->read));
  return (int64_t)ae_input_push(in, pcm, frames);
}

/** How the rack's input is doing: frames queued, and how many render cycles ran dry. */
int ae_rack_input_stats(const char *rid, uint64_t *queued, uint64_t *underruns) {
  ae_init_globals();
  [gLock lock];
  AERack *r = ae_rack(rid);
  AEInput *in = r.input;
  [gLock unlock];
  if (!in) return -3;
  uint64_t w = atomic_load(&in->written), rd = atomic_load(&in->read);
  if (queued) *queued = w > rd ? w - rd : 0;
  if (underruns) *underruns = atomic_load(&in->underruns);
  return 0;
}

/** A zone of the sample player: `path` played for notes lo..hi, at its own pitch on `root`. An empty path removes the zone. */
int ae_sampler_zone(const char *rid, int index, const char *path, int lo, int hi, int root, float gain, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      if (!r || !r.sampler) { ae_set_err(err, @"That rack has no sample player"); [gLock unlock]; return -3; }
      NSNumber *k = @(index);
      if (!path || !*path) { [r.sampler.zones removeObjectForKey:k]; }
      else {
        NSString *why = nil;
        AVAudioPCMBuffer *b = ae_load_file(r.cx, [NSString stringWithUTF8String:path], &why);
        if (!b) { ae_set_err(err, why); [gLock unlock]; return -4; }
        AEZone *z = [AEZone new];
        z.buffer = b;
        z.lo = MAX(0, MIN(127, MIN(lo, hi)));
        z.hi = MAX(0, MIN(127, MAX(lo, hi)));
        z.root = MAX(0, MIN(127, root));
        z.gain = gain < 0 ? 0 : gain > 4 ? 4 : gain;
        r.sampler.zones[k] = z;
      }
    AE_GUARD_END(-1)
    return 0;
  }
}

int ae_effect_insert(const char *rid, const char *sid, int index, uint32_t type, uint32_t sub, uint32_t manu, char **err) {
  @autoreleasepool {
    NSString *why = nil;
    AVAudioUnit *u = ae_instantiate(type, sub, manu, &why);
    if (!u) { ae_set_err(err, why); return -4; }
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      if (!r) { ae_set_err(err, @"No such rack"); [gLock unlock]; return -3; }
      NSString *key = [NSString stringWithUTF8String:sid];
      if (ae_effect_slot(r, key, NULL)) { ae_set_err(err, @"That slot is taken"); [gLock unlock]; return -5; }
      AESlot *s = [AESlot new];
      s.sid = key;
      s.unit = u;
      [ae_engine(r.cx) attachNode:u];
      NSUInteger at = index < 0 || (NSUInteger)index > r.effects.count ? r.effects.count : (NSUInteger)index;
      [r.effects insertObject:s atIndex:at];
      @try { ae_rewire(r); }
      @catch (NSException *x) {
        // This effect won't take the rack's format: take it out again.
        [r.effects removeObject:s];
        [ae_engine(r.cx) detachNode:u];
        ae_rewire(r);
        ae_set_err(err, [NSString stringWithFormat:@"That effect can't be connected here (%@)", x.reason]);
        [gLock unlock];
        return -6;
      }
      if (!ae_start(r.cx, &why)) { ae_set_err(err, why); [gLock unlock]; return -2; }
    AE_GUARD_END(-1)
    return 0;
  }
}

int ae_effect_remove(const char *rid, const char *sid, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      AESlot *s = r ? ae_effect_slot(r, [NSString stringWithUTF8String:sid], NULL) : nil;
      if (s) {
        ae_close_window([NSString stringWithFormat:@"%@/%@", r.rid, s.sid]);
        [r.effects removeObject:s];
        [ae_engine(r.cx) disconnectNodeOutput:s.unit];
        [ae_engine(r.cx) detachNode:s.unit];
        ae_rewire(r);
      }
    AE_GUARD_END(-1)
    return 0;
  }
}

int ae_effect_move(const char *rid, const char *sid, int index, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      NSUInteger from = 0;
      AESlot *s = r ? ae_effect_slot(r, [NSString stringWithUTF8String:sid], &from) : nil;
      if (s) {
        [r.effects removeObjectAtIndex:from];
        NSUInteger at = index < 0 || (NSUInteger)index > r.effects.count ? r.effects.count : (NSUInteger)index;
        [r.effects insertObject:s atIndex:at];
        ae_rewire(r);
      }
    AE_GUARD_END(-1)
    return 0;
  }
}

int ae_slot_bypass(const char *rid, const char *sid, int bypass, char **err) {
  AE_GUARD_BEGIN
    AERack *r = ae_rack(rid);
    AESlot *s = r ? ae_effect_slot(r, [NSString stringWithUTF8String:sid], NULL) : nil;
    if (s) { s.bypass = bypass != 0; s.unit.AUAudioUnit.shouldBypassEffect = s.bypass; }
  AE_GUARD_END(-1)
  return 0;
}

// ── Touch to configure: watching a slot's parameters ─────────────────────────
//
// While Configure is on for a slot (docs/audio-engine.md, Configure), an
// AUParameterTree observer queues every parameter change the unit reports,
// and each drain also compares every value with a snapshot (for a unit that
// doesn't report its window's moves to observers). Changes the host made
// itself (ae_param_set: mappings, glides, the card) are left out. A local
// event monitor notes clicks, drags and scrolls in the slot's plug-in window,
// so the Rust side can tell a touch from a parameter that moves on its own
// (touch.rs). Only live racks are watched; a render never is.

#define AE_WATCH_QUEUE 4096
#define AE_ACT_EVENTS 32
/** A change within this long of the host's own set of that parameter is the host's (ns). */
#define AE_HOST_SET_NS 300000000ull

@interface AEWatch : NSObject
@property (nonatomic, copy) NSString *rid;
@property (nonatomic, copy) NSString *sid;
@property (nonatomic, strong) AUParameterTree *tree;
@property (nonatomic, assign) AUParameterObserverToken token;
@property (nonatomic, strong) NSMutableArray *queue; // @[address, value, ns]; gWatchQLock
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, NSNumber *> *snap;
@property (nonatomic, strong) NSMutableDictionary<NSNumber *, NSNumber *> *hostSet; // address → ns
@property (nonatomic) uint64_t startNs;
@end
@implementation AEWatch
@end

/** What the person did in a plug-in window lately (gActLock). */
@interface AEActivity : NSObject
@property (nonatomic, strong) NSMutableArray<NSNumber *> *events; // ns, newest last
@property (nonatomic) uint64_t downNs, upNs;
@end
@implementation AEActivity
@end

static NSMutableDictionary<NSString *, AEWatch *> *gWatches = nil; // "rack/slot"; under gLock
static os_unfair_lock gWatchQLock = OS_UNFAIR_LOCK_INIT;
static NSMutableDictionary<NSString *, AEActivity *> *gActivity = nil; // "rack/slot"; gActLock
static os_unfair_lock gActLock = OS_UNFAIR_LOCK_INIT;
static id gEventMonitor = nil; // main thread only

static uint64_t ae_now_ns(void) { return ae_host_ns(mach_absolute_time()); }

static NSString *ae_window_key(NSWindow *w) {
  if (!w) return nil;
  NSString *found = nil;
  [gWinLock lock];
  for (NSString *k in gWindows) if (gWindows[k] == w) { found = k; break; }
  [gWinLock unlock];
  return found;
}

static void ae_note_event(NSEvent *e) {
  NSWindow *w = e.window;
  NSString *key = ae_window_key(w);
  if (!key) return;
  // Only the plug-in's own area counts (not the title bar).
  NSView *content = w.contentView;
  if (content && ![content mouse:[content convertPoint:e.locationInWindow fromView:nil] inRect:content.bounds]) return;
  uint64_t now = ae_now_ns();
  os_unfair_lock_lock(&gActLock);
  if (!gActivity) gActivity = [NSMutableDictionary new];
  AEActivity *a = gActivity[key];
  if (!a) { a = [AEActivity new]; a.events = [NSMutableArray new]; gActivity[key] = a; }
  [a.events addObject:@(now)];
  if (a.events.count > AE_ACT_EVENTS) [a.events removeObjectAtIndex:0];
  NSEventType t = e.type;
  if (t == NSEventTypeLeftMouseDown || t == NSEventTypeRightMouseDown || t == NSEventTypeOtherMouseDown) a.downNs = now;
  if (t == NSEventTypeLeftMouseUp || t == NSEventTypeRightMouseUp || t == NSEventTypeOtherMouseUp) a.upNs = now;
  os_unfair_lock_unlock(&gActLock);
}

/** The event monitor is on while anything is watched (called under gLock; the monitor itself is made on the main thread). */
static void ae_watch_monitor(BOOL on) {
  dispatch_async(dispatch_get_main_queue(), ^{
    if (on && !gEventMonitor) {
      NSEventMask mask = NSEventMaskLeftMouseDown | NSEventMaskLeftMouseUp | NSEventMaskLeftMouseDragged
        | NSEventMaskRightMouseDown | NSEventMaskRightMouseUp | NSEventMaskOtherMouseDown | NSEventMaskOtherMouseUp
        | NSEventMaskOtherMouseDragged | NSEventMaskScrollWheel;
      gEventMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:mask handler:^NSEvent *(NSEvent *e) {
        @try { ae_note_event(e); } @catch (NSException *x) { (void)x; }
        return e;
      }];
    } else if (!on && gEventMonitor) {
      [NSEvent removeMonitor:gEventMonitor];
      gEventMonitor = nil;
    }
  });
}

static void ae_watch_end(NSString *key) {
  AEWatch *w = gWatches[key];
  if (!w) return;
  if (w.token) [w.tree removeParameterObserver:w.token];
  [gWatches removeObjectForKey:key];
  os_unfair_lock_lock(&gActLock);
  [gActivity removeObjectForKey:key];
  os_unfair_lock_unlock(&gActLock);
  if (!gWatches.count) ae_watch_monitor(NO);
}

static NSMutableDictionary<NSNumber *, NSNumber *> *ae_param_snapshot(AUParameterTree *tree) {
  NSMutableDictionary *snap = [NSMutableDictionary new];
  for (AUParameter *p in tree.allParameters) if (p.flags & kAudioUnitParameterFlag_IsWritable) snap[@(p.address)] = @(p.value);
  return snap;
}

/** Start watching a live slot's parameters (again, from now, if it was). */
int ae_watch_start(const char *rid, const char *sid, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      if (!r || r.cx != gLive) { ae_set_err(err, @"No such slot"); [gLock unlock]; return -3; }
      NSString *slot = [NSString stringWithUTF8String:sid];
      AVAudioUnit *u = ae_slot_unit(r, slot);
      AUParameterTree *tree = u.AUAudioUnit.parameterTree;
      if (!u || !tree) { ae_set_err(err, u ? @"It has no parameters" : @"No such slot"); [gLock unlock]; return -3; }
      if (!gWatches) gWatches = [NSMutableDictionary new];
      NSString *key = [NSString stringWithFormat:@"%@/%@", r.rid, slot];
      ae_watch_end(key);
      AEWatch *w = [AEWatch new];
      w.rid = r.rid;
      w.sid = slot;
      w.tree = tree;
      w.queue = [NSMutableArray new];
      w.snap = ae_param_snapshot(tree);
      w.hostSet = [NSMutableDictionary new];
      w.startNs = ae_now_ns();
      NSMutableArray *q = w.queue;
      w.token = [tree tokenByAddingParameterObserver:^(AUParameterAddress address, AUValue value) {
        uint64_t ns = ae_now_ns();
        os_unfair_lock_lock(&gWatchQLock);
        if (q.count < AE_WATCH_QUEUE) [q addObject:@[@(address), @(value), @(ns)]];
        os_unfair_lock_unlock(&gWatchQLock);
      }];
      gWatches[key] = w;
      ae_watch_monitor(YES);
    AE_GUARD_END(-1)
    return 0;
  }
}

int ae_watch_stop(const char *rid, const char *sid) {
  @autoreleasepool {
    ae_init_globals();
    [gLock lock];
    @try { ae_watch_end([NSString stringWithFormat:@"%s/%s", rid ?: "", sid ?: ""]); } @catch (NSException *x) { (void)x; }
    [gLock unlock];
    return 0;
  }
}

/** The host is setting a watched parameter: not a touch (under gLock). The observer token to set it with, so the watch isn't told. */
static AUParameterObserverToken ae_watch_host_set(const char *rid, NSString *sid, AUParameter *p) {
  if (!gWatches.count || !rid) return nil;
  AEWatch *w = gWatches[[NSString stringWithFormat:@"%s/%@", rid, sid]];
  if (!w) return nil;
  w.hostSet[@(p.address)] = @(ae_now_ns());
  return w.token;
}

static void ae_watch_after_set(const char *rid, NSString *sid, AUParameter *p) {
  if (!gWatches.count || !rid) return;
  AEWatch *w = gWatches[[NSString stringWithFormat:@"%s/%@", rid, sid]];
  if (w) w.snap[@(p.address)] = @(p.value);
}

static BOOL ae_host_made(AEWatch *w, uint64_t address, uint64_t ns) {
  NSNumber *at = w.hostSet[@(address)];
  if (!at) return NO;
  uint64_t h = at.unsignedLongLongValue;
  return ns + 50000000ull >= h && ns <= h + AE_HOST_SET_NS;
}

/**
 * JSON: what changed in each watched slot since the last drain, and what the
 * person did in its window. Times are seconds since the watch started.
 * [{"rack","slot","now","changes":[{"a":"12","v":0.5,"t":1.2}],"events":[t…],"down":t|null,"up":t|null,"gone":bool}]
 */
char *ae_watch_drain(void) {
  @autoreleasepool {
    ae_init_globals();
    NSMutableArray *out = [NSMutableArray new];
    [gLock lock];
    @try {
      uint64_t now = ae_now_ns();
      for (NSString *key in [gWatches.allKeys copy]) {
        AEWatch *w = gWatches[key];
        uint64_t start = w.startNs;
        double (^rel)(uint64_t) = ^double(uint64_t ns) { return ((double)ns - (double)start) / 1e9; };
        AERack *r = gLive.racks[w.rid];
        AVAudioUnit *u = r ? ae_slot_unit(r, w.sid) : nil;
        if (!u || u.AUAudioUnit.parameterTree != w.tree) {
          NSString *rid = w.rid, *sid = w.sid;
          ae_watch_end(key);
          [out addObject:@{ @"rack": rid, @"slot": sid, @"now": @(rel(now)), @"changes": @[], @"events": @[], @"down": [NSNull null], @"up": [NSNull null], @"gone": @YES }];
          continue;
        }
        NSMutableArray *changes = [NSMutableArray new];
        NSArray *queued;
        os_unfair_lock_lock(&gWatchQLock);
        queued = [w.queue copy];
        [w.queue removeAllObjects];
        os_unfair_lock_unlock(&gWatchQLock);
        for (NSArray *c in queued) {
          uint64_t a = [c[0] unsignedLongLongValue], ns = [c[2] unsignedLongLongValue];
          if (ae_host_made(w, a, ns)) continue;
          if (!w.snap[@(a)]) continue; // not a writable parameter (a meter, an output)
          [changes addObject:@{ @"a": [NSString stringWithFormat:@"%llu", a], @"v": c[1], @"t": @(rel(ns)) }];
        }
        // Every value against the snapshot: what the observer wasn't told.
        for (AUParameter *p in w.tree.allParameters) {
          if (!(p.flags & kAudioUnitParameterFlag_IsWritable)) continue;
          NSNumber *k = @(p.address);
          float v = p.value;
          NSNumber *was = w.snap[k];
          w.snap[k] = @(v);
          if (!was) continue;
          float o = was.floatValue;
          if (fabsf(v - o) <= 1e-6f * fmaxf(1.0f, fabsf(o))) continue;
          if (ae_host_made(w, p.address, now)) continue;
          [changes addObject:@{ @"a": [NSString stringWithFormat:@"%llu", (unsigned long long)p.address], @"v": @(v), @"t": @(rel(now)) }];
        }
        NSMutableArray *events = [NSMutableArray new];
        id down = [NSNull null], up = [NSNull null];
        os_unfair_lock_lock(&gActLock);
        AEActivity *act = gActivity[key];
        for (NSNumber *e in act.events) [events addObject:@(rel(e.unsignedLongLongValue))];
        if (act.downNs) down = @(rel(act.downNs));
        if (act.upNs) up = @(rel(act.upNs));
        os_unfair_lock_unlock(&gActLock);
        [out addObject:@{ @"rack": w.rid, @"slot": w.sid, @"now": @(rel(now)), @"changes": changes, @"events": events, @"down": down, @"up": up, @"gone": @NO }];
      }
    } @catch (NSException *x) { NSLog(@"[audio engine] watch drain failed: %@", x.reason); }
    [gLock unlock];
    NSData *json = [NSJSONSerialization dataWithJSONObject:out options:0 error:nil];
    return ae_strdup(json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]");
  }
}

/** JSON: a slot's parameters ("inst" is the instrument). */
char *ae_params(const char *rid, const char *sid, char **err) {
  @autoreleasepool {
    NSMutableArray *list = [NSMutableArray new];
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      AVAudioUnit *u = r ? ae_slot_unit(r, [NSString stringWithUTF8String:sid]) : nil;
      if (!u) { ae_set_err(err, @"No such slot"); [gLock unlock]; return NULL; }
      for (AUParameter *p in u.AUAudioUnit.parameterTree.allParameters) {
        if (!(p.flags & kAudioUnitParameterFlag_IsWritable)) continue;
        NSMutableDictionary *d = [@{
          @"address": [NSString stringWithFormat:@"%llu", (unsigned long long)p.address],
          @"identifier": p.identifier ?: @"",
          @"name": p.displayName ?: p.identifier ?: @"",
          @"min": @(p.minValue), @"max": @(p.maxValue), @"value": @(p.value),
          @"unit": @((int)p.unit), @"unitName": p.unitName ?: @"",
          @"flags": @((unsigned int)p.flags),
        } mutableCopy];
        if (p.valueStrings.count) d[@"values"] = p.valueStrings;
        [list addObject:d];
      }
    AE_GUARD_END(NULL)
    NSData *json = [NSJSONSerialization dataWithJSONObject:list options:0 error:nil];
    return ae_strdup(json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]");
  }
}

/** An AUv2 unit (not a v3 one bridged to the v2 API): its Cocoa view listens through AUEventListener. */
static BOOL ae_is_v2(AudioUnit au) {
  if (!au) return NO;
  AudioComponent c = AudioComponentInstanceGetComponent(au);
  AudioComponentDescription d = {0};
  if (!c || AudioComponentGetDescription(c, &d) != noErr) return NO;
  return !(d.componentFlags & kAudioComponentFlag_IsV3AudioUnit);
}

/**
 * The host set a parameter: tell the plug-in's own window. Setting through the
 * AUParameterTree already reaches an AUv3 view's observers (and any other
 * observer; a watch's own token is the originator, so Configure doesn't count
 * it as a touch). An AUv2 unit's Cocoa or Carbon-era view listens through
 * AUEventListener instead, which a raw set never tells: post the change there.
 * The v2 bridge's parameter addresses in the global scope are the parameter ids.
 */
static void ae_notify_v2_listeners(AVAudioUnit *u, AUParameterAddress address) {
  AudioUnit au = u.audioUnit;
  if (address > UINT32_MAX || !ae_is_v2(au)) return;
  AudioUnitEvent ev = {0};
  ev.mEventType = kAudioUnitEvent_ParameterValueChange;
  ev.mArgument.mParameter.mAudioUnit = au;
  ev.mArgument.mParameter.mParameterID = (AudioUnitParameterID)address;
  ev.mArgument.mParameter.mScope = kAudioUnitScope_Global;
  ev.mArgument.mParameter.mElement = 0;
  AUEventListenerNotify(NULL, NULL, &ev);
}

int ae_param_set(const char *rid, const char *sid, uint64_t address, float value, char **err) {
  AE_GUARD_BEGIN
    AERack *r = ae_rack(rid);
    AVAudioUnit *u = r ? ae_slot_unit(r, [NSString stringWithUTF8String:sid]) : nil;
    AUParameter *p = u ? [u.AUAudioUnit.parameterTree parameterWithAddress:address] : nil;
    if (!p) { ae_set_err(err, @"No such parameter"); [gLock unlock]; return -3; }
    float v = value < p.minValue ? p.minValue : value > p.maxValue ? p.maxValue : value;
    NSString *slot = [NSString stringWithUTF8String:sid];
    [p setValue:v originator:ae_watch_host_set(rid, slot, p)]; // a watch's own observer isn't told
    ae_notify_v2_listeners(u, address); // the plug-in's AUv2 view follows (after the host-set mark, so a watch ignores it)
    ae_watch_after_set(rid, slot, p);
  AE_GUARD_END(-1)
  return 0;
}

/**
 * Tests: set a parameter through ae_param_set and count what a plug-in window
 * would hear within `wait` seconds: AUEventListener value changes (an AUv2
 * view) and AUParameterTree observer calls (an AUv3 view). 0 when it ran.
 */
int ae_test_param_heard(const char *rid, const char *sid, uint64_t address, float value, double wait, int *v2_heard, int *tree_heard) {
  @autoreleasepool {
    __block _Atomic int v2 = 0, tree = 0;
    AVAudioUnit *u = nil;
    ae_init_globals();
    [gLock lock];
    AERack *r = ae_rack(rid);
    u = r ? ae_slot_unit(r, [NSString stringWithUTF8String:sid]) : nil;
    [gLock unlock];
    if (!u) return -3;
    dispatch_queue_t q = dispatch_queue_create("ae.test.listen", DISPATCH_QUEUE_SERIAL);
    AUEventListenerRef listener = NULL;
    AUEventListenerCreateWithDispatchQueue(&listener, 0, 0, q, ^(void *obj, const AudioUnitEvent *ev, UInt64 t, AudioUnitParameterValue val) {
      (void)obj; (void)t; (void)val;
      if (ev->mEventType == kAudioUnitEvent_ParameterValueChange && ev->mArgument.mParameter.mParameterID == (AudioUnitParameterID)address) atomic_fetch_add(&v2, 1);
    });
    if (listener && u.audioUnit) {
      AudioUnitEvent ev = {0};
      ev.mEventType = kAudioUnitEvent_ParameterValueChange;
      ev.mArgument.mParameter = (AudioUnitParameter){ u.audioUnit, (AudioUnitParameterID)address, kAudioUnitScope_Global, 0 };
      AUEventListenerAddEventType(listener, NULL, &ev);
    }
    AUParameterTree *pt = u.AUAudioUnit.parameterTree;
    AUParameterObserverToken tok = [pt tokenByAddingParameterObserver:^(AUParameterAddress a, AUValue v) { (void)v; if (a == address) atomic_fetch_add(&tree, 1); }];
    char *err = NULL;
    int rc = ae_param_set(rid, sid, address, value, &err);
    if (err) free(err);
    [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:wait]];
    [NSThread sleepForTimeInterval:wait];
    dispatch_sync(q, ^{});
    [pt removeParameterObserver:tok];
    if (listener) AUListenerDispose(listener);
    if (v2_heard) *v2_heard = atomic_load(&v2);
    if (tree_heard) *tree_heard = atomic_load(&tree);
    return rc;
  }
}

/** The slot's whole state (a preset), as a property list in base64; NULL when it has none. */
char *ae_state_get(const char *rid, const char *sid, char **err) {
  @autoreleasepool {
    NSString *out = nil;
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      AVAudioUnit *u = r ? ae_slot_unit(r, [NSString stringWithUTF8String:sid]) : nil;
      NSDictionary *st = u.AUAudioUnit.fullState;
      if (st) {
        NSData *d = [NSPropertyListSerialization dataWithPropertyList:st format:NSPropertyListBinaryFormat_v1_0 options:0 error:nil];
        out = [d base64EncodedStringWithOptions:0];
      }
    AE_GUARD_END(NULL)
    return out ? ae_strdup(out) : NULL;
  }
}

int ae_state_set(const char *rid, const char *sid, const char *b64, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      AVAudioUnit *u = r ? ae_slot_unit(r, [NSString stringWithUTF8String:sid]) : nil;
      if (!u) { ae_set_err(err, @"No such slot"); [gLock unlock]; return -3; }
      NSData *d = [[NSData alloc] initWithBase64EncodedString:[NSString stringWithUTF8String:b64] options:0];
      id st = d ? [NSPropertyListSerialization propertyListWithData:d options:0 format:NULL error:nil] : nil;
      if (![st isKindOfClass:[NSDictionary class]]) { ae_set_err(err, @"That preset can't be read"); [gLock unlock]; return -4; }
      u.AUAudioUnit.fullState = st;
    AE_GUARD_END(-1)
    return 0;
  }
}

/** One MIDI channel message to the rack's instrument (or sample player). */
int ae_midi(const char *rid, uint8_t status, uint8_t d1, uint8_t d2, char **err) {
  AE_GUARD_BEGIN
    AERack *r = ae_rack(rid);
    if (!r) { ae_set_err(err, @"No such rack"); [gLock unlock]; return -3; }
    if (r.sampler) ae_sampler_midi(r.sampler, status, d1, d2);
    else if (r.instrument) {
      uint8_t kind = status & 0xf0;
      BOOL two = kind == 0xc0 || kind == 0xd0;
      if ([r.instrument isKindOfClass:[AVAudioUnitMIDIInstrument class]]) {
        AVAudioUnitMIDIInstrument *mi = (AVAudioUnitMIDIInstrument *)r.instrument;
        if (two) [mi sendMIDIEvent:status data1:d1];
        else [mi sendMIDIEvent:status data1:d1 data2:d2];
      } else {
        AUScheduleMIDIEventBlock block = r.instrument.AUAudioUnit.scheduleMIDIEventBlock;
        uint8_t bytes[3] = { status, d1, d2 };
        if (block) block(AUEventSampleTimeImmediate, 0, two ? 2 : 3, bytes);
      }
    }
  AE_GUARD_END(-1)
  return 0;
}

/** The newest `n` samples (mono) of the rack's output, oldest first; how many of them there were. `total` gets the running count. */
int ae_rack_read(const char *rid, float *out, int n, uint64_t *total) {
  ae_init_globals();
  [gLock lock];
  AERack *r = ae_rack(rid);
  [gLock unlock];
  if (!r || n <= 0) return 0;
  os_unfair_lock_lock(&r->ringLock);
  uint64_t w = r->written;
  int have = (int)MIN((uint64_t)MIN(n, AE_RING), w);
  for (int i = 0; i < have; i++) out[n - have + i] = r->ring[(w - have + i) % AE_RING];
  os_unfair_lock_unlock(&r->ringLock);
  for (int i = 0; i < n - have; i++) out[i] = 0;
  if (total) *total = w;
  return have;
}

/** The seconds of latency a rack's chain reports (each unit's `latency`), for lining a render up. */
double ae_rack_latency(const char *rid) {
  ae_init_globals();
  [gLock lock];
  double s = 0;
  @try {
    AERack *r = ae_rack(rid);
    if (r.instrument) s += r.instrument.AUAudioUnit.latency;
    for (AESlot *e in r.effects) if (!e.bypass) s += e.unit.AUAudioUnit.latency;
  } @catch (NSException *x) { (void)x; }
  [gLock unlock];
  return s;
}

int ae_master(float volume, int mute) {
  ae_init_globals();
  [gLock lock];
  gLive.masterVolume = volume < 0 ? 0 : volume > 2 ? 2 : volume;
  gLive.masterMute = mute != 0;
  @try { ae_apply_master(gLive); } @catch (NSException *x) { (void)x; }
  [gLock unlock];
  return 0;
}

/** JSON: output devices [{id, name, default}]. */
char *ae_outputs(void) {
  @autoreleasepool {
    NSMutableArray *list = [NSMutableArray new];
    AudioObjectPropertyAddress a = { kAudioHardwarePropertyDevices, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    UInt32 size = 0;
    AudioDeviceID def = 0;
    UInt32 dsz = sizeof(def);
    AudioObjectPropertyAddress da = { kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
    AudioObjectGetPropertyData(kAudioObjectSystemObject, &da, 0, NULL, &dsz, &def);
    if (AudioObjectGetPropertyDataSize(kAudioObjectSystemObject, &a, 0, NULL, &size) == noErr && size) {
      UInt32 count = size / sizeof(AudioDeviceID);
      AudioDeviceID *ids = malloc(size);
      if (ids && AudioObjectGetPropertyData(kAudioObjectSystemObject, &a, 0, NULL, &size, ids) == noErr) {
        for (UInt32 i = 0; i < count; i++) {
          AudioObjectPropertyAddress sa = { kAudioDevicePropertyStreams, kAudioObjectPropertyScopeOutput, kAudioObjectPropertyElementMain };
          UInt32 ssz = 0;
          if (AudioObjectGetPropertyDataSize(ids[i], &sa, 0, NULL, &ssz) != noErr || ssz == 0) continue;
          CFStringRef name = NULL;
          UInt32 nsz = sizeof(name);
          AudioObjectPropertyAddress na = { kAudioObjectPropertyName, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
          if (AudioObjectGetPropertyData(ids[i], &na, 0, NULL, &nsz, &name) != noErr || !name) continue;
          [list addObject:@{ @"id": @(ids[i]), @"name": (__bridge_transfer NSString *)name, @"default": @(ids[i] == def) }];
        }
      }
      free(ids);
    }
    NSData *json = [NSJSONSerialization dataWithJSONObject:list options:0 error:nil];
    return ae_strdup(json ? [[NSString alloc] initWithData:json encoding:NSUTF8StringEncoding] : @"[]");
  }
}

/** Send the engine to output device `device` (0: the system default). */
int ae_set_output(uint32_t device, char **err) {
  AE_GUARD_BEGIN
    if (gLive.offline) { [gLock unlock]; return 0; }
    AVAudioEngine *e = ae_engine(gLive);
    AudioDeviceID id = device;
    if (!id) {
      UInt32 dsz = sizeof(id);
      AudioObjectPropertyAddress da = { kAudioHardwarePropertyDefaultOutputDevice, kAudioObjectPropertyScopeGlobal, kAudioObjectPropertyElementMain };
      AudioObjectGetPropertyData(kAudioObjectSystemObject, &da, 0, NULL, &dsz, &id);
    }
    BOOL was = e.isRunning;
    [e stop];
    AudioUnit out = e.outputNode.audioUnit;
    OSStatus st = out ? AudioUnitSetProperty(out, kAudioOutputUnitProperty_CurrentDevice, kAudioUnitScope_Global, 0, &id, sizeof(id)) : -1;
    if (was || gLive.racks.count) { [e prepare]; [e startAndReturnError:nil]; }
    if (st != noErr) { ae_set_err(err, [NSString stringWithFormat:@"Couldn't switch to that output (%d)", (int)st]); [gLock unlock]; return -4; }
  AE_GUARD_END(-1)
  return 0;
}

// ── Offline rendering ────────────────────────────────────────────────────────

/** Open the render context: an offline engine at `rate` for racks named "render:…". One at a time. */
int ae_render_open(double rate, char **err) {
  AE_GUARD_BEGIN
    if (gRender) { ae_set_err(err, @"A render is already open"); [gLock unlock]; return -5; }
    AEContext *cx = [AEContext new];
    cx.racks = [NSMutableDictionary new];
    cx.offline = YES;
    cx.offlineRate = rate > 0 ? rate : 48000;
    cx.masterVolume = 1;
    gRender = cx;
    (void)ae_engine(cx);
  AE_GUARD_END(-1)
  return 0;
}

/** Close the render context: its racks and units go. */
int ae_render_close(void) {
  ae_init_globals();
  [gLock lock];
  @try {
    AEContext *cx = gRender;
    if (cx) {
      for (AERack *r in cx.racks.allValues) ae_rack_teardown(r);
      [cx.racks removeAllObjects];
      [cx.engine stop];
      cx.engine = nil;
    }
    gRender = nil;
  } @catch (NSException *x) { (void)x; gRender = nil; }
  [gLock unlock];
  return 0;
}

/** The context that renders offline: the render context when open, else the live one when it is offline (tests). */
static AEContext *ae_offline_context(void) {
  if (gRender) return gRender;
  return gLive.offline ? gLive : nil;
}

/** Render `frames` frames of the offline context into `left` and `right` (either may be NULL). Returns the frames rendered, or < 0. */
int ae_render_stereo(float *left, float *right, int frames, char **err) {
  @autoreleasepool {
    int done = 0;
    AE_GUARD_BEGIN
      AEContext *cx = ae_offline_context();
      if (!cx) { ae_set_err(err, @"Not an offline engine"); [gLock unlock]; return -1; }
      AVAudioEngine *e = ae_engine(cx);
      NSString *why = nil;
      if (!ae_start(cx, &why)) { ae_set_err(err, why); [gLock unlock]; return -2; }
      AVAudioPCMBuffer *buf = [[AVAudioPCMBuffer alloc] initWithPCMFormat:e.manualRenderingFormat frameCapacity:4096];
      while (done < frames) {
        AVAudioFrameCount chunk = (AVAudioFrameCount)MIN(4096, frames - done);
        NSError *rerr = nil;
        AVAudioEngineManualRenderingStatus st = [e renderOffline:chunk toBuffer:buf error:&rerr];
        if (st != AVAudioEngineManualRenderingStatusSuccess) { ae_set_err(err, rerr.localizedDescription ?: [NSString stringWithFormat:@"Render status %ld", (long)st]); break; }
        AVAudioChannelCount ch = buf.format.channelCount;
        for (AVAudioFrameCount i = 0; i < buf.frameLength; i++) {
          float l = buf.floatChannelData[0][i];
          float r = ch > 1 ? buf.floatChannelData[1][i] : l;
          if (left) left[done + i] = l;
          if (right) right[done + i] = r;
        }
        done += (int)buf.frameLength;
      }
    AE_GUARD_END(-1)
    return done;
  }
}

/** Offline engines only: render `frames` frames, mixed down to mono into `out`. Returns the frames rendered, or < 0. */
int ae_render_offline(float *out, int frames, char **err) {
  if (frames <= 0) return 0;
  float *r = malloc(sizeof(float) * (size_t)frames);
  if (!r) return -1;
  int n = ae_render_stereo(out, r, frames, err);
  for (int i = 0; i < n; i++) out[i] = (out[i] + r[i]) * 0.5f;
  free(r);
  return n;
}

// ── The main-mixer tap (the live engine's sound, for recordings) ─────────────

/** Start collecting the live engine's output (after its master volume) into the tap ring. Returns the install time in ns (mach), or 0. */
uint64_t ae_tap_start(char **err) {
  @autoreleasepool {
    uint64_t at = 0;
    AE_GUARD_BEGIN
      if (gTapOn) { ae_set_err(err, @"The tap is already on"); [gLock unlock]; return 0; }
      AVAudioEngine *e = ae_engine(gLive);
      if (!gTapRing) gTapRing = calloc((size_t)AE_TAP_FRAMES * 2, sizeof(float));
      os_unfair_lock_lock(&gTapLock);
      gTapWritten = 0; gTapRead = 0; gTapFirstNs = 0;
      gTapRate = ae_rate(gLive);
      gTapInstallNs = ae_host_ns(mach_absolute_time());
      at = gTapInstallNs;
      os_unfair_lock_unlock(&gTapLock);
      [e.mainMixerNode installTapOnBus:0 bufferSize:512 format:nil block:^(AVAudioPCMBuffer *buf, AVAudioTime *when) {
        if (!buf.floatChannelData) return;
        AVAudioFrameCount n = buf.frameLength;
        AVAudioChannelCount ch = buf.format.channelCount;
        if (!n || !ch) return;
        float *const *data = buf.floatChannelData;
        BOOL inter = buf.format.isInterleaved;
        os_unfair_lock_lock(&gTapLock);
        if (!gTapFirstNs) gTapFirstNs = when.hostTimeValid ? ae_host_ns(when.hostTime) : ae_host_ns(mach_absolute_time());
        uint64_t w = gTapWritten;
        for (AVAudioFrameCount i = 0; i < n; i++) {
          float l = inter ? data[0][i * ch] : data[0][i];
          float r = ch > 1 ? (inter ? data[0][i * ch + 1] : data[1][i]) : l;
          size_t at2 = (size_t)((w + i) % AE_TAP_FRAMES) * 2;
          gTapRing[at2] = l;
          gTapRing[at2 + 1] = r;
        }
        gTapWritten = w + n;
        os_unfair_lock_unlock(&gTapLock);
      }];
      gTapOn = YES;
      NSString *why = nil;
      if (!ae_start(gLive, &why)) { ae_set_err(err, why); }
    AE_GUARD_END(0)
    return at;
  }
}

/**
 * Drain the tap: up to `max` interleaved stereo frames into `out`. `from` gets
 * the frame count of the first frame returned (a jump past the last read means
 * the ring overflowed: those frames are lost). Returns the frames written.
 */
int ae_tap_read(float *out, int max, uint64_t *from, uint64_t *written) {
  ae_init_globals();
  if (!gTapRing || max <= 0) { if (from) *from = 0; if (written) *written = 0; return 0; }
  os_unfair_lock_lock(&gTapLock);
  uint64_t w = gTapWritten, r = gTapRead;
  if (w > r + AE_TAP_FRAMES) r = w - AE_TAP_FRAMES; // fell behind: the oldest are gone
  uint64_t have = w - r;
  int n = (int)MIN((uint64_t)max, have);
  for (int i = 0; i < n; i++) {
    size_t at = (size_t)((r + i) % AE_TAP_FRAMES) * 2;
    out[i * 2] = gTapRing[at];
    out[i * 2 + 1] = gTapRing[at + 1];
  }
  if (from) *from = r;
  if (written) *written = w;
  gTapRead = r + n;
  os_unfair_lock_unlock(&gTapLock);
  return n;
}

/** The tap's clock: its sample rate, when it was installed and when its first buffer was rendered (mach ns; 0 while none came). */
int ae_tap_info(double *rate, uint64_t *install_ns, uint64_t *first_ns) {
  ae_init_globals();
  os_unfair_lock_lock(&gTapLock);
  if (rate) *rate = gTapRate;
  if (install_ns) *install_ns = gTapInstallNs;
  if (first_ns) *first_ns = gTapFirstNs;
  os_unfair_lock_unlock(&gTapLock);
  return gTapOn ? 0 : -1;
}

int ae_tap_stop(void) {
  ae_init_globals();
  [gLock lock];
  @try {
    if (gTapOn && gLive.engine) [gLive.engine.mainMixerNode removeTapOnBus:0];
  } @catch (NSException *x) { (void)x; }
  gTapOn = NO;
  [gLock unlock];
  return 0;
}

// ── Plug-in windows ──────────────────────────────────────────────────────────
//
// A plug-in's window opens at the plug-in's own size (ae_plugin_size: an AUv3's
// preferredContentSize, else the loaded view's own size). It can be resized only along
// the axes the plug-in's view and its contents stretch (ae_view_axes); then the view is
// pinned to the window and its own minimum (auto layout's fitting size) is honoured, and
// an axis that doesn't stretch stays at the plug-in's size. With neither, the window is
// fixed (no Resizable in its style), except that a view bigger than the
// screen goes in a scroll view the window can grow up to the view's full size. When the
// plug-in changes its own size (preferredContentSize, or an AUv2 view's frame) the window
// follows, keeping its top-left corner. The last frame per plug-in (keyed by its
// component description) is kept in the user defaults and restored on reopen: the
// position always, the size only when the plug-in resizes; always clamped to a screen.

#define AE_WIN_DEFAULTS @"PlugInWindowFrames"

static BOOL ae_size_ok(NSSize s) {
  return isfinite(s.width) && isfinite(s.height) && s.width >= 16 && s.height >= 16 && s.width < 20000 && s.height < 20000;
}

/**
 * Where a plug-in window goes (pure; AppKit frame coordinates, origin bottom-left).
 *   want:   w, h — the frame size the plug-in asks for.
 *   axes:   the axes the window resizes along (1 width, 2 height): on those a saved
 *           size replaces `want`, then `limits` apply.
 *   limits: minW, minH, maxW, maxH (a max ≤ 0 is unbounded), or NULL.
 *   saved:  x, y, w, h of the last frame, or NULL.
 *   screen: x, y, w, h of the screen's visible frame.
 *   out:    x, y, w, h (whole points).
 * With no saved frame the window is centred on the screen; with one it keeps the saved
 * top-left corner. Either way it's no bigger than the screen and wholly on it.
 * Returns 1 when the saved frame was used, 0 when not, -1 on bad arguments.
 */
int ae_win_place(const double *want, int axes, const double *limits, const double *saved, const double *screen, double *out) {
  if (!want || !screen || !out) return -1;
  double w = want[0], h = want[1];
  int used = saved && isfinite(saved[0]) && isfinite(saved[1]) && saved[2] > 0 && saved[3] > 0;
  if (used && (axes & 1)) w = saved[2];
  if (used && (axes & 2)) h = saved[3];
  if ((axes & 1) && limits) {
    if (limits[2] > 0) w = fmin(w, limits[2]);
    w = fmax(w, limits[0]);
  }
  if ((axes & 2) && limits) {
    if (limits[3] > 0) h = fmin(h, limits[3]);
    h = fmax(h, limits[1]);
  }
  double sx = screen[0], sy = screen[1], sw = screen[2], sh = screen[3];
  w = round(fmax(1, fmin(w, sw)));
  h = round(fmax(1, fmin(h, sh)));
  double x, y;
  if (used) { x = saved[0]; y = saved[1] + saved[3] - h; }
  else { x = sx + (sw - w) / 2; y = sy + (sh - h) / 2; }
  x = fmin(fmax(x, sx), sx + sw - w);
  y = fmin(fmax(y, sy), sy + sh - h);
  out[0] = round(x); out[1] = round(y); out[2] = w; out[3] = h;
  return used;
}

static NSString *ae_win_code(OSType t) {
  char c[5] = { (char)((t >> 24) & 0xff), (char)((t >> 16) & 0xff), (char)((t >> 8) & 0xff), (char)(t & 0xff), 0 };
  for (int i = 0; i < 4; i++) if (c[i] < 0x20 || c[i] > 0x7e) return [NSString stringWithFormat:@"%08x", (unsigned)t];
  return [NSString stringWithUTF8String:c];
}

/** A plug-in's key for its remembered window: "type/subtype/manufacturer" as four-char codes. */
static NSString *ae_unit_key(OSType t, OSType s, OSType m) {
  return [NSString stringWithFormat:@"%@/%@/%@", ae_win_code(t), ae_win_code(s), ae_win_code(m)];
}

char *ae_win_key(uint32_t t, uint32_t s, uint32_t m) {
  @autoreleasepool { return ae_strdup(ae_unit_key(t, s, m)); }
}

static NSUserDefaults *ae_win_defaults(const char *suite) {
  return suite && *suite ? [[NSUserDefaults alloc] initWithSuiteName:[NSString stringWithUTF8String:suite]] : NSUserDefaults.standardUserDefaults;
}

static BOOL ae_win_recall_in(NSUserDefaults *d, NSString *key, double *out) {
  NSDictionary *all = [d dictionaryForKey:AE_WIN_DEFAULTS];
  NSArray *a = [all[key] isKindOfClass:NSArray.class] ? all[key] : nil;
  if (a.count != 4) return NO;
  for (int i = 0; i < 4; i++) {
    if (![a[i] isKindOfClass:NSNumber.class]) return NO;
    out[i] = [a[i] doubleValue];
    if (!isfinite(out[i])) return NO;
  }
  return out[2] > 0 && out[3] > 0;
}

static void ae_win_store_in(NSUserDefaults *d, NSString *key, const double *r) {
  NSMutableDictionary *all = [[d dictionaryForKey:AE_WIN_DEFAULTS] mutableCopy] ?: [NSMutableDictionary new];
  if (r) all[key] = @[@(r[0]), @(r[1]), @(r[2]), @(r[3])];
  else [all removeObjectForKey:key];
  [d setObject:all forKey:AE_WIN_DEFAULTS];
}

/** Remember (rect x,y,w,h) or forget (rect NULL) a plug-in's window frame; suite NULL = the app's defaults. */
int ae_win_store(const char *suite, const char *key, const double *rect) {
  @autoreleasepool {
    if (!key) return -1;
    @try { ae_win_store_in(ae_win_defaults(suite), [NSString stringWithUTF8String:key], rect); }
    @catch (NSException *x) { (void)x; return -1; }
    return 0;
  }
}

/** The remembered frame of a plug-in's window: 1 and out = x,y,w,h, or 0 when there's none. */
int ae_win_recall(const char *suite, const char *key, double *out) {
  @autoreleasepool {
    if (!key || !out) return -1;
    @try { return ae_win_recall_in(ae_win_defaults(suite), [NSString stringWithUTF8String:key], out) ? 1 : 0; }
    @catch (NSException *x) { (void)x; return -1; }
  }
}

static NSView *ae_cocoa_view(AudioUnit au) {
  UInt32 size = 0;
  Boolean writable = false;
  if (AudioUnitGetPropertyInfo(au, kAudioUnitProperty_CocoaUI, kAudioUnitScope_Global, 0, &size, &writable) != noErr || size < sizeof(AudioUnitCocoaViewInfo)) return nil;
  AudioUnitCocoaViewInfo *info = malloc(size);
  if (!info) return nil;
  NSView *view = nil;
  if (AudioUnitGetProperty(au, kAudioUnitProperty_CocoaUI, kAudioUnitScope_Global, 0, info, &size) == noErr) {
    NSURL *url = (__bridge_transfer NSURL *)info->mCocoaAUViewBundleLocation;
    NSString *cls = (__bridge_transfer NSString *)info->mCocoaAUViewClass[0];
    NSBundle *b = url ? [NSBundle bundleWithURL:url] : nil;
    Class c = b && cls ? [b classNamed:cls] : nil;
    if (c && [c conformsToProtocol:@protocol(AUCocoaUIBase)]) {
      id<AUCocoaUIBase> factory = [c new];
      view = [factory uiViewForAudioUnit:au withSize:NSMakeSize(640, 400)];
    }
  }
  free(info);
  return view;
}

/**
 * The content size a plug-in's view asks for (points): an AUv3's preferredContentSize;
 * else, for a view laid out by constraints, its fitting size; else its frame (an AUv2
 * Cocoa view's or the generic view's own size — their fitting size is only a minimum,
 * e.g. AUDelay's 40×129 for a 484×255 view); else its intrinsic size.
 */
static NSSize ae_plugin_size(NSViewController *vc, NSView *view) {
  if (vc && ae_size_ok(vc.preferredContentSize)) return vc.preferredContentSize;
  if (!view) return NSMakeSize(480, 320);
  if (!view.translatesAutoresizingMaskIntoConstraints && ae_size_ok(view.fittingSize)) return view.fittingSize;
  if (ae_size_ok(view.frame.size)) return view.frame.size;
  NSSize i = view.intrinsicContentSize;
  if (ae_size_ok(i)) return i;
  if (ae_size_ok(view.fittingSize)) return view.fittingSize;
  return NSMakeSize(480, 320);
}

/**
 * The axes a plug-in's view can be resized along (1 width, 2 height): those it stretches
 * along (its autoresizing mask) where what's in it stretches too — tried by growing the
 * view by 120×90, laying it out, and seeing which way any subview grew by at least a
 * quarter of that (then put back) — or, with nothing in it, where it draws itself.
 * Apple's AUDelay and AUGraphicEQ stretch both ways (auto layout); the generic view and
 * DLSMusicDevice's only in width (more height would be empty space); AUNBandEQ not at
 * all. Called before the view is in a window.
 */
static int ae_view_axes(NSView *v) {
  NSAutoresizingMaskOptions m = v.autoresizingMask;
  int root = ((m & NSViewWidthSizable) ? 1 : 0) | ((m & NSViewHeightSizable) ? 2 : 0);
  NSArray<NSView *> *subs = v.subviews;
  if (!root || !subs.count) return root;
  NSMutableArray<NSValue *> *before = [NSMutableArray arrayWithCapacity:subs.count];
  for (NSView *s in subs) [before addObject:[NSValue valueWithSize:s.frame.size]];
  NSSize s0 = v.frame.size;
  int grew = 0;
  @try {
    [v setFrameSize:NSMakeSize(s0.width + 120, s0.height + 90)];
    [v layoutSubtreeIfNeeded];
    for (NSUInteger i = 0; i < subs.count; i++) {
      NSSize a = before[i].sizeValue, b = subs[i].frame.size;
      if (b.width >= a.width + 30) grew |= 1; // a quarter of the growth: not a control settling by a point or two
      if (b.height >= a.height + 22) grew |= 2;
    }
  } @catch (NSException *x) { (void)x; }
  [v setFrameSize:s0];
  [v layoutSubtreeIfNeeded];
  return root & grew;
}

/**
 * Whether an AUv3 would take a view half as big again as `size`, asked through its view
 * configurations (a plug-in that knows its editor is a fixed size, e.g. JUCE's, answers
 * only for its own size). YES when it says so or doesn't say (Apple's default answer is
 * every configuration; then the view's own stretching decides).
 */
static BOOL ae_au_takes_bigger_view(AUAudioUnit *auu, NSSize size) {
  @try {
    NSArray<AUAudioUnitViewConfiguration *> *cfgs = @[
      [[AUAudioUnitViewConfiguration alloc] initWithWidth:size.width height:size.height hostHasController:NO],
      [[AUAudioUnitViewConfiguration alloc] initWithWidth:round(size.width * 1.5) height:round(size.height * 1.5) hostHasController:NO],
    ];
    NSIndexSet *ok = [auu supportedViewConfigurations:cfgs];
    return !ok.count || [ok containsIndex:1];
  } @catch (NSException *x) { (void)x; return YES; }
}

/** The screen a saved frame is on, else the app's main window's, else the main screen. */
static NSScreen *ae_screen_for(const double *saved) {
  if (saved) {
    NSPoint c = NSMakePoint(saved[0] + saved[2] / 2, saved[1] + saved[3] / 2);
    for (NSScreen *s in NSScreen.screens) if (NSPointInRect(c, s.frame)) return s;
  }
  NSWindow *mw = NSApp.mainWindow ?: NSApp.keyWindow;
  return mw.screen ?: NSScreen.mainScreen ?: NSScreen.screens.firstObject;
}

static void ae_rect_out(NSRect r, double *o) { o[0] = r.origin.x; o[1] = r.origin.y; o[2] = r.size.width; o[3] = r.size.height; }
static NSRect ae_rect_in(const double *o) { return NSMakeRect(o[0], o[1], o[2], o[3]); }

static char kAEPlugWin;
static char kAEPrefSize;

/** One open plug-in window: follows the plug-in's size, remembers its frame, cleans up on close. */
@interface AEPlugWin : NSObject <NSWindowDelegate>
@property (nonatomic, weak) NSWindow *window;
@property (nonatomic, strong) NSViewController *vc;
@property (nonatomic, strong) NSView *view;
@property (nonatomic, strong) NSScrollView *scroll;
@property (nonatomic, copy) NSString *key;
@property (nonatomic, copy) NSString *unitKey;
@property (nonatomic) int axes; // the axes the window resizes along (1 width, 2 height)
@property (nonatomic) BOOL observing, fitting;
@end

@implementation AEPlugWin

- (void)start {
  self.observing = YES;
  if (self.vc) [self.vc addObserver:self forKeyPath:@"preferredContentSize" options:0 context:&kAEPrefSize];
  else {
    self.view.postsFrameChangedNotifications = YES;
    [[NSNotificationCenter defaultCenter] addObserver:self selector:@selector(viewFrameChanged:) name:NSViewFrameDidChangeNotification object:self.view];
  }
}

- (void)stop {
  if (!self.observing) return;
  self.observing = NO;
  if (self.vc) { @try { [self.vc removeObserver:self forKeyPath:@"preferredContentSize" context:&kAEPrefSize]; } @catch (NSException *x) { (void)x; } }
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (void)observeValueForKeyPath:(NSString *)path ofObject:(id)obj change:(NSDictionary *)change context:(void *)ctx {
  if (ctx != &kAEPrefSize) { [super observeValueForKeyPath:path ofObject:obj change:change context:ctx]; return; }
  __weak AEPlugWin *weak = self;
  dispatch_async(dispatch_get_main_queue(), ^{ [weak fit]; });
}

- (void)viewFrameChanged:(NSNotification *)n {
  (void)n;
  if (self.fitting || !self.window) return;
  if (self.scroll || !NSEqualSizes(self.view.frame.size, self.window.contentView.bounds.size)) [self fit];
}

/** The plug-in changed its size: the window follows (top-left kept, on screen). */
- (void)fit {
  NSWindow *w = self.window;
  if (!w || self.fitting) return;
  NSSize s = self.vc ? self.vc.preferredContentSize : self.view.frame.size;
  if (!ae_size_ok(s)) return;
  self.fitting = YES;
  @try {
    NSScreen *screen = w.screen ?: ae_screen_for(NULL);
    NSRect vis = screen ? screen.visibleFrame : w.frame;
    if (self.scroll) {
      // Scrolling: the document takes the new size; the window may not outgrow it.
      [self.view setFrameSize:s];
      w.contentMaxSize = s;
      NSSize cur = w.contentView.bounds.size;
      s = NSMakeSize(MIN(cur.width, s.width), MIN(cur.height, s.height));
    }
    NSRect cr = [w contentRectForFrameRect:w.frame];
    if (!NSEqualSizes(cr.size, s)) {
      NSRect nf = [w frameRectForContentRect:NSMakeRect(cr.origin.x, NSMaxY(cr) - s.height, s.width, s.height)];
      double want[2] = { nf.size.width, nf.size.height }, saved[4], scr[4], out[4];
      ae_rect_out(nf, saved);
      ae_rect_out(vis, scr);
      ae_win_place(want, 3, NULL, saved, scr, out);
      // An axis the user can't resize along stays at the plug-in's (new) size.
      NSSize c = [w contentRectForFrameRect:ae_rect_in(out)].size, mn = w.contentMinSize, mx = w.contentMaxSize;
      if (!(self.axes & 1)) { mn.width = c.width; mx.width = c.width; }
      if (!(self.axes & 2)) { mn.height = c.height; mx.height = c.height; }
      w.contentMinSize = mn;
      w.contentMaxSize = mx;
      [w setFrame:ae_rect_in(out) display:YES];
    }
    if (!self.scroll) self.view.frame = w.contentView.bounds;
  } @catch (NSException *x) { NSLog(@"[audio engine] plug-in window resize failed: %@", x.reason); }
  self.fitting = NO;
}

- (void)remember {
  NSWindow *w = self.window;
  if (!w || !self.unitKey) return;
  double r[4];
  ae_rect_out(w.frame, r);
  ae_win_store_in(NSUserDefaults.standardUserDefaults, self.unitKey, r);
}

- (void)windowDidMove:(NSNotification *)n { (void)n; [self remember]; }
- (void)windowDidEndLiveResize:(NSNotification *)n { (void)n; [self remember]; }

- (void)windowWillClose:(NSNotification *)n {
  (void)n;
  [self remember];
  [self stop];
  NSWindow *w = self.window;
  w.delegate = nil;
  [gWinLock lock];
  if (w && gWindows[self.key] == w) [gWindows removeObjectForKey:self.key];
  [gWinLock unlock];
}

- (void)dealloc { [self stop]; }

@end

/** Show a slot's plug-in window, or bring its open one to the front. Main thread. */
static void ae_show_window(NSString *key, NSString *unitKey, NSString *title, NSView *view, NSViewController *vc, AUAudioUnit *auu) {
  [gWinLock lock];
  NSWindow *old = gWindows[key];
  [gWinLock unlock];
  if (old) {
    if (old.miniaturized) [old deminiaturize:nil];
    [old makeKeyAndOrderFront:nil];
    return;
  }
  NSView *pv = vc ? vc.view : view; // loads an AUv3's view
  if (!pv) return;
  AEPlugWin *c = [AEPlugWin new];
  c.key = key;
  c.unitKey = unitKey;
  c.vc = vc;
  c.view = pv;
  NSSize want = ae_plugin_size(vc, pv);
  want = NSMakeSize(ceil(want.width), ceil(want.height)); // whole points: crisp at any backing scale
  c.axes = ae_view_axes(pv);
  if (c.axes && vc && auu && !ae_au_takes_bigger_view(auu, want)) c.axes = 0;

  double saved[4];
  BOOL hasSaved = unitKey && ae_win_recall_in(NSUserDefaults.standardUserDefaults, unitKey, saved);
  NSScreen *screen = ae_screen_for(hasSaved ? saved : NULL);
  NSRect vis = screen ? screen.visibleFrame : NSMakeRect(0, 0, 1440, 900);

  NSWindowStyleMask style = NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable;
  NSRect fr = [NSWindow frameRectForContentRect:NSMakeRect(0, 0, want.width, want.height) styleMask:style];
  NSSize chrome = NSMakeSize(fr.size.width - want.width, fr.size.height - want.height);
  NSSize minS = NSMakeSize(160, 100), maxS = NSZeroSize;
  BOOL scroll = !c.axes && (fr.size.width > vis.size.width || fr.size.height > vis.size.height);
  if (scroll) {
    // Bigger than the screen: scroll, and let the window grow up to the whole view.
    c.axes = 3;
    minS = NSMakeSize(MIN(want.width, 240), MIN(want.height, 160));
    maxS = want;
  } else if (c.axes) {
    NSSize f = pv.fittingSize; // a minimum only when constraints lay it out
    if (!pv.translatesAutoresizingMaskIntoConstraints && ae_size_ok(f)) minS = f;
    minS = NSMakeSize(MIN(minS.width, want.width), MIN(minS.height, want.height));
  }
  // An axis the window doesn't resize along is held at the plug-in's size.
  if (!(c.axes & 1)) { minS.width = want.width; maxS.width = want.width; }
  if (!(c.axes & 2)) { minS.height = want.height; maxS.height = want.height; }
  if (c.axes) style |= NSWindowStyleMaskResizable;

  double wantF[2] = { fr.size.width, fr.size.height };
  double limits[4] = { minS.width + chrome.width, minS.height + chrome.height, maxS.width > 0 ? maxS.width + chrome.width : 0, maxS.height > 0 ? maxS.height + chrome.height : 0 };
  double scr[4], out[4];
  ae_rect_out(vis, scr);
  ae_win_place(wantF, c.axes, limits, hasSaved ? saved : NULL, scr, out);
  NSRect frame = ae_rect_in(out);

  NSWindow *w = [[NSWindow alloc] initWithContentRect:[NSWindow contentRectForFrameRect:frame styleMask:style] styleMask:style backing:NSBackingStoreBuffered defer:NO];
  w.releasedWhenClosed = NO;
  w.title = title;
  [w setFrame:frame display:NO];
  NSSize cs = [w contentRectForFrameRect:frame].size;
  NSRect bounds = NSMakeRect(0, 0, cs.width, cs.height);
  NSView *container = [[NSView alloc] initWithFrame:bounds];
  container.autoresizesSubviews = YES;
  if (scroll) {
    NSScrollView *sv = [[NSScrollView alloc] initWithFrame:bounds];
    sv.hasVerticalScroller = YES;
    sv.hasHorizontalScroller = YES;
    sv.autohidesScrollers = YES;
    sv.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    pv.frame = NSMakeRect(0, 0, want.width, want.height);
    sv.documentView = pv;
    [container addSubview:sv];
    c.scroll = sv;
    [pv scrollPoint:NSMakePoint(0, pv.isFlipped ? 0 : NSMaxY(pv.bounds))]; // the top first
  } else {
    // Pinned to the window: it's exactly the content area.
    pv.frame = bounds;
    if (c.axes) pv.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
    [container addSubview:pv];
    if (!pv.translatesAutoresizingMaskIntoConstraints) {
      [NSLayoutConstraint activateConstraints:@[
        [pv.leadingAnchor constraintEqualToAnchor:container.leadingAnchor],
        [pv.trailingAnchor constraintEqualToAnchor:container.trailingAnchor],
        [pv.topAnchor constraintEqualToAnchor:container.topAnchor],
        [pv.bottomAnchor constraintEqualToAnchor:container.bottomAnchor],
      ]];
    }
  }
  w.contentView = container;
  // Limits in content points; a fixed axis is the window's own (maybe screen-clamped) size.
  w.contentMinSize = NSMakeSize((c.axes & 1) ? MIN(minS.width, cs.width) : cs.width, (c.axes & 2) ? MIN(minS.height, cs.height) : cs.height);
  w.contentMaxSize = NSMakeSize((c.axes & 1) ? (maxS.width > 0 ? maxS.width : CGFLOAT_MAX) : cs.width,
                                (c.axes & 2) ? (maxS.height > 0 ? maxS.height : CGFLOAT_MAX) : cs.height);
  c.window = w;
  objc_setAssociatedObject(w, &kAEPlugWin, c, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  w.delegate = c;
  [c start];
  [w makeKeyAndOrderFront:nil];
  [gWinLock lock];
  gWindows[key] = w;
  [gWinLock unlock];
}

/** Open the slot's own window: the plug-in's view, its Cocoa view (AUv2), else a generic one. */
int ae_open_ui(const char *rid, const char *sid, const char *title, char **err) {
  @autoreleasepool {
    AE_GUARD_BEGIN
      AERack *r = ae_rack(rid);
      if (!r || r.cx.offline) { ae_set_err(err, r ? @"No windows offline" : @"No such slot"); [gLock unlock]; return r ? -1 : -3; }
      NSString *slot = [NSString stringWithUTF8String:sid];
      AVAudioUnit *u = ae_slot_unit(r, slot);
      if (!u) { ae_set_err(err, @"No such slot"); [gLock unlock]; return -3; }
      NSString *key = [NSString stringWithFormat:@"%@/%@", r.rid, slot];
      NSString *name = [NSString stringWithUTF8String:title ?: ""];
      if (!name.length) name = u.name ?: @"Audio Unit";
      AudioComponentDescription d = u.audioComponentDescription;
      NSString *unitKey = ae_unit_key(d.componentType, d.componentSubType, d.componentManufacturer);
      AUAudioUnit *auu = u.AUAudioUnit;
      AudioUnit au = u.audioUnit;
      [auu requestViewControllerWithCompletionHandler:^(AUViewControllerBase *vc) {
        dispatch_async(dispatch_get_main_queue(), ^{
          @try {
            if (vc) ae_show_window(key, unitKey, name, nil, vc, auu);
            else {
              NSView *v = au ? ae_cocoa_view(au) : nil;
              if (!v && au) {
                AUGenericView *g = [[AUGenericView alloc] initWithAudioUnit:au displayFlags:AUViewTitleDisplayFlag | AUViewPropertiesDisplayFlag | AUViewParametersDisplayFlag];
                g.showsExpertParameters = YES;
                v = g;
              }
              if (v) ae_show_window(key, unitKey, name, v, nil, nil);
            }
          } @catch (NSException *x) { NSLog(@"[audio engine] plug-in window failed: %@", x.reason); }
        });
      }];
    AE_GUARD_END(-1)
    return 0;
  }
}

// ── The trial-load helper process (src/audio_engine/safety.rs) ──────────────

/** In the `--au-probe` process: an AppKit application that never shows in the Dock, for plug-ins that expect one. */
void ae_probe_prepare(void) {
  @autoreleasepool {
    @try {
      [NSApplication sharedApplication];
      [NSApp setActivationPolicy:NSApplicationActivationPolicyProhibited];
    } @catch (NSException *x) { (void)x; }
  }
}

/** Run the main thread's run loop (and so the main dispatch queue) for `seconds`: a plug-in loading on another thread may need it. */
void ae_pump_main(double seconds) {
  @autoreleasepool {
    [[NSRunLoop mainRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:seconds]];
  }
}
