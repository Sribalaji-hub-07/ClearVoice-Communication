using System;
using System.Diagnostics;
using System.IO;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

namespace ClearVoiceApp
{
    static class Program
    {
        private static bool IsPortOpen(string host, int port)
        {
            try
            {
                using (var client = new TcpClient())
                {
                    var result = client.BeginConnect(host, port, null, null);
                    bool success = result.AsyncWaitHandle.WaitOne(800);
                    if (!success) return false;
                    client.EndConnect(result);
                    return true;
                }
            }
            catch
            {
                return false;
            }
        }

        [STAThread]
        static void Main(string[] args)
        {
            string appDir = AppDomain.CurrentDomain.BaseDirectory;
            string targetUrl = "http://localhost:5173";

            // If server is not yet listening, launch it in background
            if (!IsPortOpen("localhost", 5173) && !IsPortOpen("localhost", 3001))
            {
                try
                {
                    ProcessStartInfo serverPsi = new ProcessStartInfo
                    {
                        FileName = "cmd.exe",
                        Arguments = "/c npm run dev:all",
                        WorkingDirectory = appDir,
                        CreateNoWindow = true,
                        UseShellExecute = false
                    };
                    Process.Start(serverPsi);
                    
                    // Wait up to 10 seconds for the server to be ready
                    for (int i = 0; i < 20; i++)
                    {
                        Thread.Sleep(500);
                        if (IsPortOpen("localhost", 5173) || IsPortOpen("localhost", 3001))
                        {
                            break;
                        }
                    }
                }
                catch (Exception ex)
                {
                    MessageBox.Show("Could not start background voice server: " + ex.Message, "ClearVoice", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }

            if (IsPortOpen("localhost", 5173))
            {
                targetUrl = "http://localhost:5173";
            }
            else if (IsPortOpen("localhost", 3001))
            {
                targetUrl = "http://localhost:3001";
            }

            // Launch Edge in Standalone Application Mode (Chromium Desktop App Window)
            string edgePath = @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe";
            if (!File.Exists(edgePath))
            {
                edgePath = @"C:\Program Files\Microsoft\Edge\Application\msedge.exe";
            }

            if (File.Exists(edgePath))
            {
                ProcessStartInfo appPsi = new ProcessStartInfo
                {
                    FileName = edgePath,
                    Arguments = "--app=\"" + targetUrl + "\" --window-size=1380,880 --enable-media-stream",
                    UseShellExecute = false
                };
                Process edgeProc = Process.Start(appPsi);
            }
            else
            {
                // Fallback to default browser
                Process.Start(targetUrl);
            }
        }
    }
}
