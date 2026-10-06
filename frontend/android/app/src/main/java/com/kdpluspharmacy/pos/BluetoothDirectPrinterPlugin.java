package com.kdpluspharmacy.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

/** Prints receipt text directly to a paired Bluetooth Classic ESC/POS printer. */
@CapacitorPlugin(
    name = "BluetoothDirectPrinter",
    permissions = { @Permission(alias = "bluetooth", strings = { Manifest.permission.BLUETOOTH_CONNECT }) }
)
public class BluetoothDirectPrinterPlugin extends Plugin {
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void getPairedPrinters(PluginCall call) {
        if (!ensurePermission(call, "listPairedPrinters")) return;
        listPairedPrinters(call);
    }

    @PermissionCallback
    private void listPairedPrinters(PluginCall call) {
        try {
            BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
            if (adapter == null) { call.reject("This Android device does not support Bluetooth."); return; }
            if (!adapter.isEnabled()) { call.reject("Turn on Bluetooth, then refresh the paired printer list."); return; }
            JSArray printers = new JSArray();
            Set<BluetoothDevice> devices = adapter.getBondedDevices();
            for (BluetoothDevice device : devices) {
                JSObject printer = new JSObject();
                printer.put("name", device.getName() == null ? "Bluetooth printer" : device.getName());
                printer.put("address", device.getAddress());
                printers.put(printer);
            }
            JSObject result = new JSObject();
            result.put("printers", printers);
            call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Allow KDPLUS to connect to Bluetooth devices in Android settings.", error);
        }
    }

    @PluginMethod
    public void print(PluginCall call) {
        if (!ensurePermission(call, "printAfterPermission")) return;
        printAfterPermission(call);
    }

    @PermissionCallback
    private void printAfterPermission(PluginCall call) {
        String address = call.getString("printerAddress");
        JSArray segments = call.getArray("segments");
        if (!validAddress(address)) { call.reject("Select a paired Bluetooth printer in KDPLUS Settings."); return; }
        if (segments == null || segments.length() == 0) { call.reject("There is no receipt text to print."); return; }
        byte[] bytes;
        try {
            bytes = buildDocument(segments, Boolean.TRUE.equals(call.getBoolean("openDrawer", false)));
        } catch (Exception error) {
            call.reject("Could not prepare the receipt for printing.", error);
            return;
        }
        send(call, address, bytes);
    }

    @PluginMethod
    public void openCashDrawer(PluginCall call) {
        if (!ensurePermission(call, "openDrawerAfterPermission")) return;
        openDrawerAfterPermission(call);
    }

    @PermissionCallback
    private void openDrawerAfterPermission(PluginCall call) {
        String address = call.getString("printerAddress");
        if (!validAddress(address)) { call.reject("Select a paired Bluetooth printer in KDPLUS Settings."); return; }
        send(call, address, new byte[] { 0x1b, 0x70, 0x00, 0x19, (byte) 0xfa });
    }

    @PluginMethod
    public void testPrint(PluginCall call) {
        if (!ensurePermission(call, "testPrintAfterPermission")) return;
        testPrintAfterPermission(call);
    }

    @PermissionCallback
    private void testPrintAfterPermission(PluginCall call) {
        String address = call.getString("printerAddress");
        if (!validAddress(address)) { call.reject("Select a paired Bluetooth printer in KDPLUS Settings."); return; }
        JSArray lines = new JSArray();
        try {
            JSObject header = new JSObject(); header.put("text", "KDPLUS POS"); header.put("align", "center"); header.put("bold", true); lines.put(header);
            JSObject test = new JSObject(); test.put("text", "Bluetooth printer test"); test.put("align", "center"); lines.put(test);
            JSObject paper = new JSObject(); paper.put("text", "Connection successful"); paper.put("align", "center"); lines.put(paper);
            send(call, address, buildDocument(lines, false));
        } catch (Exception error) { call.reject("Could not prepare the printer test.", error); }
    }

    private boolean ensurePermission(PluginCall call, String callback) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || getPermissionState("bluetooth") == PermissionState.GRANTED) return true;
        requestPermissionForAlias("bluetooth", call, callback);
        return false;
    }

    private boolean validAddress(String address) {
        return address != null && BluetoothAdapter.checkBluetoothAddress(address);
    }

    private byte[] buildDocument(JSArray segments, boolean openDrawer) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        bytes.write(new byte[] { 0x1b, 0x40 }); // initialize
        for (int index = 0; index < segments.length(); index++) {
            JSONObject segment = segments.getJSONObject(index);
            String align = segment.optString("align", "left");
            int alignment = "center".equals(align) ? 1 : ("right".equals(align) ? 2 : 0);
            bytes.write(new byte[] { 0x1b, 0x61, (byte) alignment });
            bytes.write(new byte[] { 0x1b, 0x45, (byte) (segment.optBoolean("bold", false) ? 1 : 0) });
            String text = segment.optString("text", "");
            String printable = text.replace("₱", "PHP ").replace("×", "x").replace("–", "-").replace("—", "-");
            bytes.write(printable.getBytes(StandardCharsets.US_ASCII));
            bytes.write(0x0a);
        }
        bytes.write(new byte[] { 0x1b, 0x45, 0, 0x1b, 0x61, 0 });
        bytes.write(new byte[] { 0x1b, 0x64, 4 }); // feed a few lines
        if (openDrawer) bytes.write(new byte[] { 0x1b, 0x70, 0x00, 0x19, (byte) 0xfa });
        return bytes.toByteArray();
    }

    private void send(PluginCall call, String address, byte[] bytes) {
        worker.execute(() -> {
            BluetoothSocket socket = null;
            try {
                BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                if (adapter == null || !adapter.isEnabled()) throw new IOException("Turn on Bluetooth and try again.");
                BluetoothDevice device = adapter.getRemoteDevice(address);
                socket = device.createRfcommSocketToServiceRecord(SPP_UUID);
                socket.connect();
                OutputStream output = socket.getOutputStream();
                output.write(bytes);
                output.flush();
                JSObject result = new JSObject(); result.put("printed", true); call.resolve(result);
            } catch (Exception error) {
                call.reject("Could not print over Bluetooth. Check that the printer is paired, on, and supports ESC/POS Bluetooth printing.", error);
            } finally {
                if (socket != null) try { socket.close(); } catch (IOException ignored) { }
            }
        });
    }
}
