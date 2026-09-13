# Mobile platform setup

`tauri android init` and `tauri ios init` generate `src-tauri/gen/`, which is
git-ignored because it is machine-specific. Both platforms need one manual
edit before local networking works — neither is expressible in
`tauri.conf.json`, so the required snippets live here.

Apply them once after running `init`. If you later regenerate `gen/`, apply
them again.

## Android

Add to `src-tauri/gen/android/app/src/main/AndroidManifest.xml`, inside
`<manifest>` and above `<application>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
<uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
<uses-permission android:name="android.permission.ACCESS_WIFI_STATE" />
<!-- Required to send the UDP discovery beacon to the subnet broadcast
     address; without it the room will not appear on other devices. -->
<uses-permission android:name="android.permission.CHANGE_WIFI_MULTICAST_STATE" />
```

`INTERNET` is Android's name for "may open sockets" and is needed even though
this game never leaves the local network.

Cleartext TCP to a LAN peer is blocked by default on Android 9+. Add to the
`<application>` tag:

```xml
android:usesCleartextTraffic="true"
```

Scoping that to the private ranges with a `network-security-config` is better
for a release build; see `network_security_config.xml` in this directory.

## iOS

Add to `src-tauri/gen/apple/<app>_iOS/Info.plist`:

```xml
<key>NSLocalNetworkUsageDescription</key>
<string>Finds other players' devices on your Wi-Fi so you can play together offline.</string>
<key>NSBonjourServices</key>
<array>
  <string>_snakesladders._tcp</string>
</array>
```

iOS 14+ shows a one-time Local Network permission prompt the first time the
app sends to the LAN. Until the player accepts it, discovery finds nothing and
the manual "join by address" path is the fallback.

**Known limitation:** iOS restricts raw UDP broadcast. Sending to
`255.255.255.255` — which is how `lan-sync`'s `Advertiser` discovers rooms —
works on Android and desktop, but on iOS it may be silently dropped unless the
app holds Apple's `com.apple.developer.networking.multicast` entitlement, which
is granted by request only. Two devices where at least one is an iPhone
therefore need either that entitlement, a Bonjour-based advertiser written
against `NSNetService` in a Tauri plugin, or the manual join-by-address path,
which always works because it is a plain TCP connection.

Building for iOS at all requires macOS with Xcode and an Apple Developer
account; there is no way around that.
