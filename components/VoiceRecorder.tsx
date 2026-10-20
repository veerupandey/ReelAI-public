
import React, { useState, useRef, useEffect } from 'react';

interface VoiceRecorderProps {
  onRecordingComplete: (blob: Blob) => void;
  onCancel: () => void;
  scriptText?: string;
}

const VoiceRecorder: React.FC<VoiceRecorderProps> = ({ onRecordingComplete, onCancel, scriptText }) => {
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  
  // Visualizer state
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      chunksRef.current = [];

      // Setup Visualizer
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioCtx.createAnalyser();
      const source = audioCtx.createMediaStreamSource(stream);
      source.connect(analyser);
      analyser.fftSize = 256;
      
      audioContextRef.current = audioCtx;
      analyserRef.current = analyser;

      mediaRecorderRef.current.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        onRecordingComplete(blob);
        cleanup();
      };

      mediaRecorderRef.current.start();
      setIsRecording(true);
      
      // Start Timer
      setRecordingTime(0);
      timerRef.current = window.setInterval(() => {
        setRecordingTime(prev => prev + 1);
      }, 1000);

      drawVisualizer();

    } catch (err) {
      console.error("Error accessing microphone", err);
      alert("Microphone access denied.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          onRecordingComplete(file); // Treat file as blob
      }
  };

  const cleanup = () => {
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
        if (audioContextRef.current) {
            try { audioContextRef.current.close(); } catch(e){}
        }
        if (mediaRecorderRef.current && mediaRecorderRef.current.stream) {
             mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
        }
  };

  const drawVisualizer = () => {
      if (!canvasRef.current || !analyserRef.current) return;
      
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      const bufferLength = analyserRef.current.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      
      const draw = () => {
          if (!isRecording) return;
          if (!canvasRef.current) return; // Safety check
          
          animationRef.current = requestAnimationFrame(draw);
          analyserRef.current!.getByteFrequencyData(dataArray);
          
          ctx.fillStyle = '#1E293B'; // dark-card color
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          
          const barWidth = (canvas.width / bufferLength) * 2.5;
          let barHeight;
          let x = 0;
          
          for (let i = 0; i < bufferLength; i++) {
              barHeight = dataArray[i] / 2;
              
              // Gradient Color
              const gradient = ctx.createLinearGradient(0, 0, 0, canvas.height);
              gradient.addColorStop(0, '#bc1888'); // insta-purple
              gradient.addColorStop(1, '#f09433'); // insta-start
              
              ctx.fillStyle = gradient;
              ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
              x += barWidth + 1;
          }
      };
      
      draw();
  };

  useEffect(() => {
    return () => {
        if (timerRef.current) clearInterval(timerRef.current);
        if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, []);

  const formatTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = seconds % 60;
      return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col gap-6 h-full animate-fade-in relative">
        {/* Top: Visualizer and Timer */}
        <div className="flex flex-col items-center gap-4 shrink-0 bg-dark-card p-6 rounded-2xl border border-dark-border shadow-xl">
            <div className="flex items-center justify-between w-full mb-2">
                <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-red-500 animate-pulse' : 'bg-gray-600'}`}></div>
                    <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                        {isRecording ? 'ON AIR' : 'STANDBY'}
                    </span>
                </div>
                <div className="font-mono text-xl font-bold text-white tabular-nums">
                    {formatTime(recordingTime)}
                </div>
            </div>

            <div className="relative w-full h-24 bg-black/40 rounded-xl overflow-hidden border border-gray-700 shadow-inner">
                <canvas ref={canvasRef} className="w-full h-full" width={400} height={96} />
                {!isRecording && recordingTime === 0 && (
                    <div className="absolute inset-0 flex items-center justify-center text-gray-500 font-medium text-sm">
                        Hit Record or Upload File
                    </div>
                )}
            </div>
            
            <div className="flex items-center gap-6 mt-2">
                {!isRecording ? (
                    <>
                        <button 
                            onClick={startRecording}
                            className="w-16 h-16 rounded-full bg-red-500 hover:bg-red-600 flex items-center justify-center shadow-lg hover:scale-105 transition-all focus:outline-none ring-4 ring-red-500/20 hover:ring-red-500/40"
                            title="Start Recording"
                        >
                            <div className="w-6 h-6 bg-white rounded-full"></div>
                        </button>
                        <button 
                            onClick={() => fileInputRef.current?.click()}
                            className="w-12 h-12 rounded-full bg-gray-700 hover:bg-gray-600 flex items-center justify-center shadow-lg transition-all"
                            title="Upload Audio File"
                        >
                             <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                             </svg>
                        </button>
                        <input type="file" ref={fileInputRef} hidden accept="audio/*" onChange={handleFileUpload} />
                    </>
                ) : (
                    <button 
                        onClick={stopRecording}
                        className="w-16 h-16 rounded-full bg-dark-bg border-2 border-red-500 flex items-center justify-center hover:bg-red-500/20 transition-all animate-pulse focus:outline-none"
                        title="Stop Recording"
                    >
                        <div className="w-6 h-6 bg-red-500 rounded-sm"></div>
                    </button>
                )}
            </div>
        </div>

        {/* Middle: Script Teleprompter */}
        <div className="flex-1 min-h-0 bg-dark-bg/50 rounded-xl border border-dark-border p-1 relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 bg-dark-bg/95 py-2 px-4 border-b border-gray-800 z-10 flex justify-between items-center">
                <h4 className="text-xs text-gray-500 uppercase tracking-wider font-bold">Teleprompter</h4>
            </div>
            <div className="overflow-y-auto custom-scrollbar h-full pt-10 p-6">
                {scriptText ? (
                    <p className="text-2xl leading-relaxed text-white font-medium text-center">
                        {scriptText}
                    </p>
                ) : (
                    <p className="text-gray-500 italic text-center mt-10">No script loaded.</p>
                )}
            </div>
        </div>
        
        {/* Bottom: Actions */}
        <div className="flex justify-center pt-2 shrink-0">
            <button onClick={onCancel} className="text-sm text-gray-400 hover:text-white px-6 py-2 hover:bg-white/5 rounded-lg transition-colors">
                Cancel
            </button>
        </div>
    </div>
  );
};

export default VoiceRecorder;