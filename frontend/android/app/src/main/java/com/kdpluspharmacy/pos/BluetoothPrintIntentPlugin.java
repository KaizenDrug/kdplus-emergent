package com.kdpluspharmacy.pos;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import java.nio.charset.StandardCharsets;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BluetoothPrintIntent")
public class BluetoothPrintIntentPlugin extends Plugin {

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        if (html == null || html.trim().isEmpty()) {
            call.reject("The receipt is empty. Please reopen the receipt and retry.");
            return;
        }
        byte[] data = html.getBytes(StandardCharsets.UTF_8);
        if (data.length > 500000) {
            call.reject("This receipt is too large for the Android print service.");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                Intent intent = new Intent("org.escpos.intent.action.PRINT");
                intent.setPackage("com.loopedlabs.escposprintservice");
                intent.putExtra("DATA_TYPE", "HTML");
                intent.putExtra("PRINT_DATA", data);
                getActivity().startActivity(intent);
                JSObject result = new JSObject();
                result.put("opened", true);
                call.resolve(result);
            } catch (ActivityNotFoundException error) {
                call.reject("Install or update ESC/POS Bluetooth Print Service by Looped Labs on this tablet.", error);
            } catch (Exception error) {
                call.reject("Could not send the receipt to ESC POS PRINT.", error);
            }
        });
    }

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("print://")) {
            call.reject("Only the configured Bluetooth print request is allowed.");
            return;
        }

        getActivity().runOnUiThread(() -> {
        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (ActivityNotFoundException error) {
            call.reject("ESC POS PRINT could not be opened. Install or enable an app that supports print://escpos.org, then configure your Bluetooth printer.", error);
        } catch (Exception error) {
            call.reject("Could not start the Bluetooth print request.", error);
        }
        });
    }
}
