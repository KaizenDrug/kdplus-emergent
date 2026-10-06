package com.kdpluspharmacy.pos;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(BluetoothPrintIntentPlugin.class);
        registerPlugin(BluetoothDirectPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
