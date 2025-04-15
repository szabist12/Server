// Define a custom AudioWorkletProcessor class to process microphone input
class AudioProcessor extends AudioWorkletProcessor {

    // This method is called for every audio render quantum (~128 samples)
    process(inputs, outputs, parameters) {
        const input = inputs[0]; // Get the first connected input

        // Check if input has at least one channel (e.g., mono)
        if (input.length > 0) {
            const channelData = input[0]; // Get audio data from the first channel

            // Make a copy of the Float32Array and send it to the main thread
            // slice() creates a shallow copy so we don't send a reference
            this.port.postMessage(channelData.slice());
        }

        // Returning true keeps the processor alive and running
        return true;
    }
}

// Register the processor with the AudioWorklet system
// 'audio-processor' must match the name used in AudioWorkletNode
registerProcessor('audio-processor', AudioProcessor);
