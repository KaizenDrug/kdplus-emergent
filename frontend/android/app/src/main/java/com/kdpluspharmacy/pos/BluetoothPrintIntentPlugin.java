package com.kdpluspharmacy.pos;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "BluetoothPrintIntent")
public class BluetoothPrintIntentPlugin extends Plugin {

    @PluginMethod
    public void open(PluginCall call) {
        String url = call.getString("url");
        if (url == null || !url.startsWith("print://")) {
            call.reject("Only the configured Bluetooth print request is allowed.");
            return;
        }

        try {
            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            getActivity().startActivity(intent);
            JSObject result = new JSObject();
            result.put("opened", true);
            call.resolve(result);
        } catch (ActivityNotFoundException error) {
            call.reject("Install and configure a compatible ESC/POS Bluetooth printing app first.", error);
        } catch (Exception error) {
            call.reject("Could not start the Bluetooth print request.", error);
        }
    }
}
