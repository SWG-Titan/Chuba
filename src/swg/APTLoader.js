class APTLoader {
    static async load(url) {
        const response = await fetch(url);
        const arrayBuffer = await response.arrayBuffer();
        const reader = new IFFReader(arrayBuffer);

        reader.enterForm('APT ');
        reader.enterForm('0000');
        const nameChunk = reader.enterChunk('NAME');

        const meshPath = reader.readString(nameChunk.size);

        reader.exitChunk(nameChunk);
        reader.exitForm();
        reader.exitForm();

        return meshPath; // Returns path to the .msh file
    }
}