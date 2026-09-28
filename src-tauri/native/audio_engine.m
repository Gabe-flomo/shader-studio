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

/** Instantiate an Audio Unit (v2 in-process, v3 out-of-process), waiting up to 10 s. */
static AVAudioUnit *ae_instantiate(OSType type, OSType sub, OSType manu, NSString **why) {
  AudioComponentDescription d = { type, sub, manu, 0, 0 };
  if (!AudioComponentFindNext(NULL, &d)) { if (why) *why = @"That Audio Unit isn't installed on this Mac"; return nil; }
  __block AVAudioUnit *out = nil;
  __block NSError *err = nil;
  dispatch_semaphore_t done = dispatch_semaphore_create(0);
  [AVAudioUnit instantiateWithComponentDescription:d options:0 completionHandler:^(AVAudioUnit *u, NSError *e) {
    out = u; err = e;
    dispatch_semaphore_signal(done);
  }];
  if (dispatch_semaphore_wait(done, dispatch_time(DISPATCH_TIME_NOW, 10 * NSEC_PER_SEC)) != 0) {
    if (why) *why = @"The Audio Unit took too long to load";
    return nil;
  }
  if (!out && why) *why = err.localizedDescription ?: @"The Audio Unit couldn't be loaded";
  return out;
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

int ae_param_set(const char *rid, const char *sid, uint64_t address, float value, char **err) {
  AE_GUARD_BEGIN
    AERack *r = ae_rack(rid);
    AVAudioUnit *u = r ? ae_slot_unit(r, [NSString stringWithUTF8String:sid]) : nil;
    AUParameter *p = u ? [u.AUAudioUnit.parameterTree parameterWithAddress:address] : nil;
    if (!p) { ae_set_err(err, @"No such parameter"); [gLock unlock]; return -3; }
    float v = value < p.minValue ? p.minValue : value > p.maxValue ? p.maxValue : value;
    [p setValue:v originator:nil];
  AE_GUARD_END(-1)
  return 0;
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

static void ae_show_window(NSString *key, NSString *title, NSView *view, NSViewController *vc) {
  [gWinLock lock];
  NSWindow *old = gWindows[key];
  [gWinLock unlock];
  if (old) { [old makeKeyAndOrderFront:nil]; return; }
  NSSize size = vc ? vc.preferredContentSize : view.frame.size;
  if (size.width < 200 || size.height < 100) size = NSMakeSize(MAX(size.width, 480), MAX(size.height, 320));
  NSWindow *w = [[NSWindow alloc] initWithContentRect:NSMakeRect(0, 0, size.width, size.height)
                                            styleMask:NSWindowStyleMaskTitled | NSWindowStyleMaskClosable | NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable
                                              backing:NSBackingStoreBuffered defer:NO];
  w.releasedWhenClosed = NO;
  w.title = title;
  if (vc) w.contentViewController = vc; else w.contentView = view;
  [w setContentSize:size];
  [w center];
  [w makeKeyAndOrderFront:nil];
  [gWinLock lock];
  gWindows[key] = w;
  [gWinLock unlock];
  __block id token = [[NSNotificationCenter defaultCenter] addObserverForName:NSWindowWillCloseNotification object:w queue:nil usingBlock:^(NSNotification *n) {
    (void)n;
    [gWinLock lock];
    if (gWindows[key] == w) [gWindows removeObjectForKey:key];
    [gWinLock unlock];
    [[NSNotificationCenter defaultCenter] removeObserver:token];
  }];
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
      AUAudioUnit *auu = u.AUAudioUnit;
      AudioUnit au = u.audioUnit;
      [auu requestViewControllerWithCompletionHandler:^(AUViewControllerBase *vc) {
        dispatch_async(dispatch_get_main_queue(), ^{
          @try {
            if (vc) ae_show_window(key, name, nil, vc);
            else {
              NSView *v = au ? ae_cocoa_view(au) : nil;
              if (!v && au) {
                AUGenericView *g = [[AUGenericView alloc] initWithAudioUnit:au displayFlags:AUViewTitleDisplayFlag | AUViewPropertiesDisplayFlag | AUViewParametersDisplayFlag];
                g.showsExpertParameters = YES;
                v = g;
              }
              if (v) ae_show_window(key, name, v, nil);
            }
          } @catch (NSException *x) { NSLog(@"[audio engine] plug-in window failed: %@", x.reason); }
        });
      }];
    AE_GUARD_END(-1)
    return 0;
  }
}
