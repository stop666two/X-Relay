const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  FAILED: 'failed',
  CLOSED: 'closed'
};

const connOption = 
{ 
  ordered: true, 
  maxRetransmits: 10, // 最大重传次数
  bufferedAmountLowThreshold: 1024 * 16 // 设置缓冲区低阈值为 16KB
}

window.xrelay_config = {
  iceServers: [
    {
      urls: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
        'stun:stun2.l.google.com:19302',
        'stun:stun3.l.google.com:19302',
        'stun:stun4.l.google.com:19302'
      ]
    }
  ],
  iceTransportPolicy: 'all',
  iceCandidatePoolSize: 10
};

class XChatUser {
  id = null;
  roomId = null;
  isMe = false;
  nickname = null;
  device = '';

  rtcConn = null;
  connAddressTarget = null;
  connAddressMe = null;
  chatChannel = null;
  candidateArr = [];

  onicecandidate = () => { };
  onmessage = () => { };
  onReceiveFile = () => { };
  onReceiveProgress = () => { };
  onConnectionStateChange = () => { };

  receivedSize = 0;
  receivedChunks = [];
  fileInfo = null;
  latency = 0;
  #pingSent = 0;

  connectionPromise = null;

  #isTransferCancelled = false;
  #transferTimeout = null;
  #expectedFileSize = 0;
  #chunkSize = 8 * 1024; // 8KB chunks
  #maxRetries = 3;
  #missingChunks = new Set();
  #totalChunks = 0;
  #chunkInfoQueue = [];
  #pendingFile = null;
  #lastBlobUrl = null;


  async createConnection() {
    const peerConnectionConstraints = {
      optional: [
        { googIPv6: false }
      ]
    };
    
    this.rtcConn = new RTCPeerConnection(window.xrelay_config, peerConnectionConstraints);
    this.chatChannel = this.rtcConn.createDataChannel('chat',  connOption);
    this.dataChannel_initEvent()
    // this.dataChannel.onopen = () => console.log('DataChannel is open');
    // this.dataChannel.onclose = () => console.log('DataChannel is closed');
    const offer = await this.rtcConn.createOffer()
    await this.rtcConn.setLocalDescription(offer)
    this.connAddressMe = this.rtcConn.localDescription;

    this.rtcConn.onicecandidateerror = (event) => {
      console.error('ICE Candidate Error:', event, {
        errorCode: event.errorCode,
        errorText: event.errorText,
        hostCandidate: event.hostCandidate,
        url: event.url
      });
    };

    this.rtcConn.onicegatheringstatechange = () => {
      const state = this.rtcConn.iceGatheringState;
      console.log(`ICE gathering state changed: ${state}`);
      
      switch(state) {
        case 'new':
          console.log('Starting to gather candidates...');
          break;
        case 'gathering':
          console.log('Gathering ICE candidates...');
          break;
        case 'complete':
          console.log('ICE gathering completed');
          console.log('Final candidates:', this.candidateArr);
          break;
      }
    };

    if (this.rtcConn.connectionState) {
      this.rtcConn.onconnectionstatechange = () => {
        this.onConnectionStateChange(this.rtcConn.connectionState);
      };
      this.rtcConn.oniceconnectionstatechange = () => {
        console.log(`ICE connection state: ${this.rtcConn.iceConnectionState}`);
      };
    } else {
      // firefox没有connectionState，也不支持onConnectionStateChange
      this.rtcConn.oniceconnectionstatechange = this.rtcConn.onsignalingstatechange = () => {
        console.log(`ICE connection state: ${this.rtcConn.iceConnectionState}`);
        this.onConnectionStateChange(this.getConnectionState());
      };
    }

    this.rtcConn.onicecandidate = event => {
      if (event.candidate) {
        console.log('ICE Candidate Details:', {
          candidate: event.candidate.candidate,
          type: event.candidate.type,
          protocol: event.candidate.protocol,
          address: event.candidate.address,
          port: event.candidate.port,
          priority: event.candidate.priority,
          foundation: event.candidate.foundation,
          relatedAddress: event.candidate.relatedAddress,
          relatedPort: event.candidate.relatedPort
        });
        this.candidateArr.push(event.candidate);
        this.onicecandidate(event.candidate, this.candidateArr);
      } else {
        console.log('ICE gathering completed');
      }
    };

    return this;
  }

  closeConnection() {
    if (this.rtcConn) {
      this.rtcConn.onconnectionstatechange = null;
      this.rtcConn.close();
    }
    this.rtcConn = null;
    this.chatChannel = null;
    this.connAddressTarget = null;
    this.connAddressMe = null;
    this.onicecandidate = () => { };
    this.onConnectionStateChange(CONNECTION_STATES.CLOSED);
  }

  async connectTarget(target) {
    if (!target) {
      throw new Error('connAddressTarget is null');
    }
    if (this.isMe || !this.id) {
      return this;
    }

    if (this.rtcConn) {
      this.closeConnection();
    }

    this.rtcConn = new RTCPeerConnection(window.xrelay_config);

    this.rtcConn.onicecandidate = event => {
      if (event.candidate) {
        this.candidateArr.push(event.candidate);
        this.onicecandidate(event.candidate, this.candidateArr);
      }
    };
    this.rtcConn.ondatachannel = (event) => {
      if (event.channel) {
        this.chatChannel = event.channel;
        this.dataChannel_initEvent();
      }
    };
    this.connAddressTarget = new RTCSessionDescription({ type: 'offer', sdp: target});
    await this.rtcConn.setRemoteDescription(this.connAddressTarget);
    
    this.connAddressMe = await this.rtcConn.createAnswer();
    await this.rtcConn.setLocalDescription(this.connAddressMe);

    if (this.rtcConn.connectionState) {
      this.rtcConn.onconnectionstatechange = () => {
        console.log(`Connection state changed: ${this.rtcConn.connectionState}`);
        this.onConnectionStateChange(this.rtcConn.connectionState);
      };
    } else {
      // firefox没有connectionState，也不支持onConnectionStateChange
      this.rtcConn.oniceconnectionstatechange = this.rtcConn.onsignalingstatechange = () => {
        this.onConnectionStateChange(this.getConnectionState());
      };
    }

    return this;
  }



  async addIceCandidate(candidate) {
    if (!this.rtcConn) {
      return;
    }
    await this.rtcConn.addIceCandidate(new RTCIceCandidate(candidate))
  }

  async setRemoteSdp(target) {
    if (this.rtcConn.signalingState === 'have-local-offer' && !this.rtcConn.remoteDescription) {
      try {
        await this.rtcConn.setRemoteDescription({ type: 'answer', sdp: target});
        console.log('Remote SDP set as answer.');
      } catch (err) {
        console.error('Error handling answer SDP:', err);
      }
    }
  }

  dataChannel_initEvent() {
    this.chatChannel.onmessage = async e => {
      const message = e.data;
      
      try {
        if (typeof message === 'string') {
          if (message.startsWith('##PING##')) {
            await this.sendMessage('##PONG##' + message.slice(8));
            return;
          }
          if (message.startsWith('##PONG##')) {
            this.latency = Date.now() - parseInt(message.slice(8));
            this.onConnectionStateChange(this.getConnectionState());
            return;
          }
          if (message.startsWith('##FILE_S##')) {
            // 重置状态
            this.fileInfo = JSON.parse(message.substring(10));
            this.#expectedFileSize = this.fileInfo.size;
            this.#totalChunks = Math.ceil(this.#expectedFileSize / this.#chunkSize);
            this.receivedChunks = new Array(this.#totalChunks).fill(null);
            this.receivedSize = 0;
            this.#missingChunks.clear();
            this.#chunkInfoQueue = [];
            this.#setTransferTimeout();
            
            // 发送确认收到文件信息
            await this.sendMessage('##FILE_S_ACK##');
            
          } else if (message === '##FILE_E##') {
            // 检查是否有缺失的块
            const missingChunks = this.receivedChunks
              .map((chunk, index) => chunk === null ? index : -1)
              .filter(index => index !== -1);

            if (missingChunks.length > 0) {
              console.log(`Missing chunks: ${missingChunks.length}, requesting retry...`);
              // 请求重传缺失的块
              await this.sendMessage(JSON.stringify({
                type: '##RETRY_REQUEST##',
                chunks: missingChunks
              }));
              return;
            }

            // 验证文件完整性
            if (this.receivedSize === this.#expectedFileSize) {
              try {
                const validChunks = this.receivedChunks.filter(chunk => chunk !== null);
                let blob = new Blob(validChunks);
                if (this.#lastBlobUrl) URL.revokeObjectURL(this.#lastBlobUrl);
                let url = URL.createObjectURL(blob);
                this.#lastBlobUrl = url;
                this.onReceiveFile({ url, name: this.fileInfo.name });
                await this.sendMessage('##FILE_RECEIVED##');
              } catch (error) {
                console.error('Error creating blob:', error);
              }
            } else {
              console.error(`File size mismatch: expected ${this.#expectedFileSize}, got ${this.receivedSize}`);
              // 重新请求所有缺失的块
              const allMissingChunks = this.receivedChunks
                .map((chunk, index) => chunk === null ? index : -1)
                .filter(index => index !== -1);
              
              if (allMissingChunks.length > 0) {
                await this.sendMessage(JSON.stringify({
                  type: '##RETRY_REQUEST##',
                  chunks: allMissingChunks
                }));
                return;
              }
            }
            this.#cleanupTransfer();
            
          } else {
            try {
              const parsed = JSON.parse(message);
              if (parsed.type === '##CHUNK_INFO##') {
                // 处理chunk信息
                this.#chunkInfoQueue.push(parsed.data);
              } else if (parsed.type === '##RETRY_REQUEST##') {
                // 处理重传请求
                console.log(`Received retry request for ${parsed.chunks.length} chunks`);
                for (const chunkIndex of parsed.chunks) {
                  await this.sendChunk(this.#pendingFile, chunkIndex);
                  // 添加小延迟避免网络拥塞
                  await new Promise(resolve => setTimeout(resolve, 50));
                }
                // 重新发送文件结束标记
                await this.sendMessage('##FILE_E##');
              } else {
                this.onmessage(message);
              }
            } catch {
              this.onmessage(message);
            }
          }
        } else if (this.receivedChunks && this.#chunkInfoQueue.length) {
          // 重置超时计时器
          this.#setTransferTimeout();
          
          const chunkInfo = this.#chunkInfoQueue.shift();
          const { index, size } = chunkInfo;
          
          if (message instanceof ArrayBuffer || message instanceof Uint8Array) {
            const buffer = message instanceof Uint8Array ? message.buffer : message;
            if (buffer.byteLength === size) {
              this.receivedChunks[index] = buffer;
              this.receivedSize += buffer.byteLength;
              this.#missingChunks.delete(index);
              
              // 进度回调
              this.onReceiveProgress(this.receivedSize, this.#expectedFileSize, this.fileInfo?.name);
              
              // 每收到100个块发送一次进度确认
              if (index % 100 === 0) {
                await this.sendMessage(JSON.stringify({
                  type: '##PROGRESS_ACK##',
                  receivedSize: this.receivedSize,
                  lastIndex: index
                }));
              }
            } else {
              console.error(`Chunk size mismatch at index ${index}`);
              this.#missingChunks.add(index);
            }
          }
        }
      } catch (error) {
        console.error('Error processing message:', error);
      }
    };

    this.chatChannel.onopen = () => console.log('chatChannel is open');
    this.chatChannel.onclose = () => console.log('DataChannel is closed');
  }
  checkBufferedAmount() {
    const maxBufferedAmount = 1024 * 64; // 降低最大缓冲区限制到 64KB
    return new Promise(resolve => {
      if (this.chatChannel.bufferedAmount > maxBufferedAmount) {
        // 如果缓冲区超过阈值，等待 bufferedamountlow 事件
        const handleBufferedAmountLow = () => {
          this.chatChannel.removeEventListener('bufferedamountlow', handleBufferedAmountLow);
          resolve();
        };
        this.chatChannel.addEventListener('bufferedamountlow', handleBufferedAmountLow);
      } else {
        // 缓冲区未满，立即解析
        resolve();
      }
    });
  }
  async sendFileBytes(file, onProgress) {
    return new Promise((resolve, reject) => {
      this.#totalChunks = Math.ceil(file.size / this.#chunkSize);
      let currentChunk = 0;
      let totalSent = 0;
      let lastProgressUpdate = Date.now();

      const sendChunk = async (chunkIndex) => {
        try {
          const start = chunkIndex * this.#chunkSize;
          const end = Math.min(start + this.#chunkSize, file.size);
          const chunk = file.slice(start, end);
          
          // 读取chunk数据
          const buffer = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsArrayBuffer(chunk);
          });

          // 创建包含元数据的消息
          const chunkInfo = {
            index: chunkIndex,
            total: this.#totalChunks,
            size: buffer.byteLength
          };
          
          // 发送chunk信息
          await this.sendMessage(JSON.stringify({
            type: '##CHUNK_INFO##',
            data: chunkInfo
          }));
          
          // 发送实际数据
          await this.checkBufferedAmount();
          await this.chatChannelSendBuffer(buffer);
          totalSent += buffer.byteLength;

          // 更新进度
          const now = Date.now();
          if (now - lastProgressUpdate > 100) {
            if (onProgress) {
              onProgress(totalSent, file.size);
            }
            lastProgressUpdate = now;
          }

        } catch (e) {
          console.error(`Error sending chunk ${chunkIndex}:`, e);
          throw e;
        }
      };

      const processNextChunk = async () => {
        if (this.#isTransferCancelled) return;
        if (currentChunk >= this.#totalChunks) {
          if (onProgress) onProgress(totalSent, file.size);
          resolve();
          return;
        }
        let retryCount = 0;
        const trySend = async () => {
          try {
            await sendChunk(currentChunk);
            currentChunk++;
            setTimeout(processNextChunk, 1);
          } catch (e) {
            if (retryCount < this.#maxRetries) {
              retryCount++;
              console.log(`Retrying chunk ${currentChunk}, attempt ${retryCount}`);
              setTimeout(trySend, 1000);
            } else {
              reject(e);
            }
          }
        };
        trySend();
      };

      processNextChunk();
    });
  }

  async sendFile(fileInfo, file, onProgress) {
    try {
      this.#isTransferCancelled = false;
      this.#pendingFile = file;
      
      if (this.chatChannel.readyState !== 'open') {
        throw new Error('Connection not open');
      }

      // 发送文件信息并等待确认
      await this.sendMessage('##FILE_S##' + JSON.stringify(fileInfo));
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.chatChannel.removeEventListener('message', handler);
          reject(new Error('File start confirmation timeout'));
        }, 5000);
        const handler = (e) => {
          if (e.data === '##FILE_S_ACK##') {
            clearTimeout(timeout);
            this.chatChannel.removeEventListener('message', handler);
            resolve();
          }
        };
        this.chatChannel.addEventListener('message', handler);
      });
      
      // 发送文件内容
      await this.sendFileBytes(file, onProgress);
      
      if (!this.#isTransferCancelled) {
        // 发送结束标记并等待确认
        await this.sendMessage('##FILE_E##');
        
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            this.chatChannel.removeEventListener('message', confirmHandler);
            reject(new Error('File transfer confirmation timeout'));
          }, 30000); // 增加超时时间到30秒
          
          const confirmHandler = (e) => {
            if (e.data === '##FILE_RECEIVED##') {
              clearTimeout(timeout);
              this.chatChannel.removeEventListener('message', confirmHandler);
              this.#pendingFile = null;
              resolve();
            }
          };
          
          this.chatChannel.addEventListener('message', confirmHandler);
        });
      }
    } catch (e) {
      console.error('Send file failed:', e);
      this.#pendingFile = null;
      throw e;
    }
  }
  
  async sendMessage(message) {
    if (!this.chatChannel) {
      console.log(this.id, '------chatChannel is null');
      return;
    }
    if (this.chatChannel.readyState === 'open') {
      await this.chatChannel.send(message);
    } else {
      throw new Error('DataChannel is not open');
    }
  }

  // 添加取消传输方法
  cancelTransfer() {
    this.#isTransferCancelled = true;
    if (this.chatChannel) {
      // 关闭并重新创建数据通道，确保传输被中断
      this.chatChannel.close();
      this.createDataChannel();
    }
  }

  // 创建新的数据通道
  createDataChannel() {
    if (this.rtcConn) {
      this.chatChannel = this.rtcConn.createDataChannel('chat', connOption);
      this.dataChannel_initEvent();
    }
  }

  // 添加重连方法
  async reconnect() {
    console.log('Attempting to reconnect...');
    if (this.connAddressTarget) {
      try {
        await this.connectTarget(this.connAddressTarget.sdp);
      } catch (error) {
        console.error('Reconnection failed:', error);
      }
    }
  }

  // 获取当前连接状态
  getConnectionState() {
    if (!this.rtcConn) {
      return CONNECTION_STATES.DISCONNECTED;
    }
    if (this.rtcConn.connectionState) {
      return this.rtcConn.connectionState;
    }
    // Firefox fallback: 根据 iceConnectionState 和 signalingState 推断状态
    if (this.rtcConn.iceConnectionState === 'connected' || this.rtcConn.iceConnectionState === 'completed') {
      return this.rtcConn.signalingState === 'stable' ? CONNECTION_STATES.CONNECTED : CONNECTION_STATES.CONNECTING;
    }
    if (this.rtcConn.iceConnectionState === 'disconnected') return CONNECTION_STATES.DISCONNECTED;
    if (this.rtcConn.iceConnectionState === 'failed') return CONNECTION_STATES.FAILED;
    if (this.rtcConn.iceConnectionState === 'closed') return CONNECTION_STATES.CLOSED;
    return 'new';
  }

  // 检查是否已连接
  isConnected() {
    if (!this.rtcConn) {
      return false;
    }
    if (this.rtcConn.connectionState) {
      return this.rtcConn.connectionState === 'connected';
    }
    if (this.rtcConn.iceConnectionState === 'connected' || this.rtcConn.iceConnectionState === 'completed') {
      if (this.rtcConn.signalingState === 'stable') {
        return true;
      }
    }
    return false;
  }

  // 测量延迟
  measureLatency() {
    if (!this.chatChannel || this.chatChannel.readyState !== 'open') return;
    this.#pingSent = Date.now();
    this.sendMessage('##PING##' + this.#pingSent).catch(() => {});
  }



  #setTransferTimeout() {
    this.#clearTransferTimeout();
    this.#transferTimeout = setTimeout(() => {
      console.error('File transfer timeout');
      this.#cleanupTransfer();
    }, 30000); // 30秒超时
  }
  
  #clearTransferTimeout() {
    if (this.#transferTimeout) {
      clearTimeout(this.#transferTimeout);
      this.#transferTimeout = null;
    }
  }
  
  #cleanupTransfer() {
    this.#clearTransferTimeout();
    this.receivedChunks = null;
    this.receivedSize = 0;
    this.fileInfo = null;
    this.#expectedFileSize = 0;
    this.#chunkInfoQueue = [];
  }

  async sendChunk(file, chunkIndex) {
    if (!file) {
      throw new Error('No file to send chunk from');
    }
    
    const start = chunkIndex * this.#chunkSize;
    const end = Math.min(start + this.#chunkSize, file.size);
    const chunk = file.slice(start, end);
    
    // 读取chunk数据
    const buffer = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsArrayBuffer(chunk);
    });

    // 创建包含元数据的消息
    const chunkInfo = {
      index: chunkIndex,
      total: this.#totalChunks,
      size: buffer.byteLength
    };
    
    // 发送chunk信息
    await this.sendMessage(JSON.stringify({
      type: '##CHUNK_INFO##',
      data: chunkInfo
    }));
    
    // 发送实际数据
    await this.checkBufferedAmount();
    await this.chatChannelSendBuffer(buffer);
  }
  async chatChannelSendBuffer(buffer) {
    await this.chatChannel.send(buffer);
  }
}