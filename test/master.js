const spawn = require("parall/worker").spawn



spawn("./worker_reader", 1);
spawn("./worker_writer", 1);