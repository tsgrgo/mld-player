type ProducerMessage = InitMsg | LoadMsg | StopMsg | GetTimeMsg | SetTimeMsg;

type InitMsg = {
	type: 'init';
	sab: SharedArrayBuffer;
	forceCheckMessages: SharedArrayBuffer;
	sampleRate: number;
};
type LoadMsg = { type: 'load'; buffer: ArrayBuffer };
type StopMsg = { type: 'stop' };
type GetTimeMsg = { type: 'getTime' };
type SetTimeMsg = { type: 'setTime'; time: number };

/////////////////////////////////////////

type ProducerResponse = InfoMsg;

type InfoMsg = { type: 'info'; info: MldInfo };

/////////////////////////////////////////

type ConsumerMessage = SabMsg;

type SabMsg = { type: 'sab'; sab: SharedArrayBuffer };
